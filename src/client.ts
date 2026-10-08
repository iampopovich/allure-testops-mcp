import { CacheStore, NullCacheStore } from "./cache.js";
import { TokenManager } from "./auth.js";
import { Semaphore } from "./rate-limiter.js";
import { logger } from "./logger.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined | null>;

export interface AllureApiClientOptions {
  baseUrl: string;
  tokenManager: TokenManager;
  defaultProjectId?: number;
  cache?: CacheStore;
  /** Maximum concurrent requests. 0 or negative = unlimited. Default 0 (the CLI entry point passes 1 unless ALLURE_MAX_CONCURRENT is set). */
  maxConcurrent?: number;
}

// TTL matrix (ms) — based on how frequently each entity changes. First match wins.
const PATH_TTL: Array<[RegExp, number]> = [
  [/\/api\/project/,    5 * 60_000],  // projects, users — rarely change
  [/\/api\/ev/,         5 * 60_000],  // env var definitions — very static
  [/\/api\/dashboard/,  2 * 60_000],  // dashboards
  [/\/api\/testplan/,   2 * 60_000],  // test plan structure
  [/\/api\/sharedstep/, 2 * 60_000],  // shared steps
  [/\/api\/testcase\/\d+\/(scenario|step)/, 10_000], // test steps — heavy payload, needs to be fresh
  [/\/api\/testcase/,   60_000],      // test cases — may be edited
  [/\/api\/release/,    30_000],      // releases — statistics recalc as launches land
  [/\/api\/defect/,     30_000],      // defects — change as failures are triaged
  [/\/api\/testresult/, 30_000],      // results — agent polls status
  [/\/api\/widget/,     30_000],      // dashboard widgets
  [/\/api\/launch/,     15_000],      // launches — actively mutate during runs
];

// Reference data that no tool in this server can modify — kept in cache across writes.
// Every other cached entry is dropped after any write: writes have cross-entity side
// effects (e.g. adding test cases to a launch changes launch statistics, applying a
// defect changes test results), so per-path invalidation cannot be made reliable.
const WRITE_SAFE_PREFIXES = [
  "/api/project/suggest",
  "/api/project/release-status",
  "/api/project/release-workflow",
];

const RETRYABLE_STATUSES = [502, 503, 504];
const RETRYABLE_ERROR_CODES = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"];
const MAX_RETRY_AFTER_MS = 10_000;

function getTtl(path: string): number {
  for (const [pattern, ttl] of PATH_TTL) {
    if (pattern.test(path)) return ttl;
  }
  return 60_000;
}

interface ExecuteOptions<T> {
  query?: QueryParams;
  body?: string | FormData;
  headers?: Record<string, string>;
  parse: (response: Response) => Promise<T>;
}

type AttemptResult<T> =
  | { kind: "ok"; value: T; status: number }
  | { kind: "network"; error: unknown }
  | { kind: "http"; status: number; text: string; retryAfter: string | null };

async function parseJsonOrText<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

export class AllureApiClient {
  private readonly baseUrl: string;
  private readonly tokenManager: TokenManager;
  readonly defaultProjectId: number | undefined;
  private readonly maxRetries = 2;
  private readonly requestTimeoutMs = 30000;
  private readonly cache: CacheStore;
  private readonly semaphore: Semaphore;
  /** Bumped at the start and end of every write so GETs overlapping a write never populate the cache. */
  private writeGeneration = 0;

  constructor(options: AllureApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokenManager = options.tokenManager;
    this.defaultProjectId = options.defaultProjectId;
    this.cache = options.cache ?? new NullCacheStore();
    this.semaphore = new Semaphore(options.maxConcurrent ?? 0);
  }

  async get<T>(path: string, query?: QueryParams): Promise<T> {
    const key = this.cacheKey(path, query);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      logger.debug({ method: "GET", path, cache: "hit" }, "cache hit");
      // Callers may mutate the result — never hand out the cached instance itself.
      return structuredClone(hit) as T;
    }
    logger.debug({ method: "GET", path, cache: "miss" }, "cache miss");
    const generation = this.writeGeneration;
    const result = await this.request<T>("GET", path, undefined, query);
    if (result !== null && result !== undefined && typeof result === "object") {
      if (generation === this.writeGeneration) {
        this.cache.set(key, structuredClone(result) as object, getTtl(path));
        logger.debug({ method: "GET", path, cached: true }, "response cached");
      } else {
        logger.debug({ method: "GET", path, cached: false }, "write overlapped request, response not cached");
      }
    }
    return result;
  }

  async post<T>(
    path: string,
    body?: unknown,
    query?: QueryParams,
  ): Promise<T> {
    return this.request<T>("POST", path, body, query);
  }

  async patch<T>(
    path: string,
    body?: unknown,
    query?: QueryParams,
  ): Promise<T> {
    return this.request<T>("PATCH", path, body, query);
  }

  async put<T>(path: string, body?: unknown, query?: QueryParams): Promise<T> {
    return this.request<T>("PUT", path, body, query);
  }

  async delete<T = unknown>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>("DELETE", path, undefined, query);
  }

  async postMultipart<T>(path: string, formData: FormData, query?: QueryParams): Promise<T> {
    return this.execute<T>("POST", path, {
      query,
      body: formData,
      headers: { Accept: "application/json" },
      parse: parseJsonOrText,
    });
  }

  async getRaw(path: string, query?: QueryParams): Promise<{ contentType: string; content: string; encoding: string }> {
    return this.execute("GET", path, {
      query,
      parse: async (response) => {
        const contentType = response.headers.get("content-type") ?? "application/octet-stream";
        const buffer = await response.arrayBuffer();
        const content = Buffer.from(buffer).toString("base64");
        return { contentType, content, encoding: "base64" };
      },
    });
  }

  private cacheKey(path: string, query?: QueryParams): string {
    const normalized = path.startsWith("/") ? path : "/" + path;
    if (!query) return normalized;
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => k + "=" + (Array.isArray(v) ? (v as unknown[]).join(",") : v))
      .join("&");
    return params ? normalized + "?" + params : normalized;
  }

  private invalidateAfterWrite(): void {
    this.writeGeneration += 1;
    this.cache.invalidateWhere((key) => !WRITE_SAFE_PREFIXES.some((prefix) => key.startsWith(prefix)));
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: QueryParams,
  ): Promise<T> {
    return this.execute<T>(method, path, {
      query,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      parse: parseJsonOrText,
    });
  }

  private async execute<T>(method: string, path: string, options: ExecuteOptions<T>): Promise<T> {
    const isWrite = method !== "GET";
    if (isWrite) {
      this.writeGeneration += 1;
    }
    try {
      return await this.executeWithRetries(method, path, options);
    } finally {
      // Invalidate even when the write failed: a timed-out or 5xx write may still have been applied.
      if (isWrite) {
        this.invalidateAfterWrite();
        logger.debug({ method, path }, "cache invalidated by write");
      }
    }
  }

  private async executeWithRetries<T>(method: string, path: string, options: ExecuteOptions<T>): Promise<T> {
    const start = Date.now();
    const url = this.buildUrl(path, options.query);
    let accessToken = await this.tokenManager.getAccessToken();
    let authRefreshed = false;
    let retriesLeft = this.maxRetries;

    for (let attempt = 0; ; attempt += 1) {
      const result = await this.attempt(method, url, accessToken, options);

      if (result.kind === "ok") {
        const durationMs = Date.now() - start;
        logger.debug({ method, path, status: result.status, durationMs, attempt: attempt > 0 ? attempt : undefined }, "request completed");
        return result.value;
      }

      if (result.kind === "network") {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        if (method === "GET" && retriesLeft > 0 && this.isRetryableNetworkError(result.error)) {
          retriesLeft -= 1;
          logger.warn({ method, path, attempt, err: message }, "network error, retrying");
          await this.wait(300 * (attempt + 1));
          continue;
        }
        logger.error({ method, path, err: message, durationMs: Date.now() - start }, "request failed");
        throw result.error;
      }

      // 401 with a cached JWT usually means it was revoked or expired early — refresh once.
      // The request was rejected before processing, so this is safe for writes too.
      if (result.status === 401 && !authRefreshed) {
        authRefreshed = true;
        logger.warn({ method, path }, "received 401, refreshing access token and retrying");
        this.tokenManager.invalidate(accessToken);
        accessToken = await this.tokenManager.getAccessToken();
        continue;
      }

      // 429 means the request was rejected before processing — safe to retry for any method.
      const retryable =
        result.status === 429 || (method === "GET" && RETRYABLE_STATUSES.includes(result.status));
      if (retryable && retriesLeft > 0) {
        retriesLeft -= 1;
        const delayMs = this.retryDelayMs(attempt, result.status === 429 ? result.retryAfter : null);
        logger.warn({ method, path, attempt, status: result.status, delayMs }, "server error, retrying");
        await this.wait(delayMs);
        continue;
      }

      logger.error({ method, path, status: result.status, durationMs: Date.now() - start }, "request failed");
      throw new Error("Allure API " + method + " " + path + " failed (" + result.status + "): " + result.text);
    }
  }

  /** One HTTP round-trip. Holds a concurrency permit only while the request is on the wire, never during retry back-off. */
  private async attempt<T>(
    method: string,
    url: string,
    accessToken: string,
    options: ExecuteOptions<T>,
  ): Promise<AttemptResult<T>> {
    await this.semaphore.acquire();
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            ...options.headers,
            Authorization: "Bearer " + accessToken,
          },
          body: options.body,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        return { kind: "network", error };
      }

      if (!response.ok) {
        const text = await response.text();
        const retryAfter = response.status === 429 ? response.headers.get("retry-after") : null;
        return { kind: "http", status: response.status, text, retryAfter };
      }

      if (response.status === 204) {
        return { kind: "ok", value: undefined as T, status: response.status };
      }

      return { kind: "ok", value: await options.parse(response), status: response.status };
    } finally {
      this.semaphore.release();
    }
  }

  private retryDelayMs(attempt: number, retryAfter: string | null): number {
    const fallback = 300 * (attempt + 1);
    if (!retryAfter) return fallback;
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (!Number.isFinite(ms)) return fallback;
    return Math.min(Math.max(ms, fallback), MAX_RETRY_AFTER_MS);
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : "/" + path;
    const url = new URL(this.baseUrl + normalizedPath);

    if (!query) {
      return url.toString();
    }

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.append(key, String(value));
      }
    }

    return url.toString();
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // AbortSignal.timeout() rejects with a DOMException named "TimeoutError"
    // ("The operation was aborted due to timeout"), which the message check below misses.
    if (error.name === "TimeoutError") return true;
    const code = (error.cause as { code?: unknown } | undefined)?.code;
    if (typeof code === "string" && RETRYABLE_ERROR_CODES.includes(code)) return true;
    const lower = error.message.toLowerCase();
    return (
      lower.includes("fetch failed") ||
      lower.includes("timed out") ||
      lower.includes("econnreset") ||
      lower.includes("eai_again")
    );
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
