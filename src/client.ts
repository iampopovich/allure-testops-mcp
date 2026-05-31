import { CacheStore, NullCacheStore } from "./cache.js";
import { TokenManager } from "./auth.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined | null>;

export interface AllureApiClientOptions {
  baseUrl: string;
  tokenManager: TokenManager;
  defaultProjectId?: number;
  cache?: CacheStore;
}

// TTL matrix (ms) — based on how frequently each entity changes
const PATH_TTL: Array<[RegExp, number]> = [
  [/\/api\/project/,    5 * 60_000],  // projects, users — rarely change
  [/\/api\/ev/,         5 * 60_000],  // env var definitions — very static
  [/\/api\/dashboard/,  2 * 60_000],  // dashboards
  [/\/api\/testplan/,   2 * 60_000],  // test plan structure
  [/\/api\/sharedstep/, 2 * 60_000],  // shared steps
  [/\/api\/testcase/,   60_000],      // test cases — may be edited
  [/\/api\/defect/,     30_000],      // defects — change as failures are triaged
  [/\/api\/testresult/, 30_000],      // results — agent polls status
  [/\/api\/widget/,     30_000],      // dashboard widgets
  [/\/api\/launch/,     15_000],      // launches — actively mutate during runs
  [/\/api\/scenario/,   10_000],      // test steps — heavy payload, needs to be fresh
];

function getTtl(path: string): number {
  for (const [pattern, ttl] of PATH_TTL) {
    if (pattern.test(path)) return ttl;
  }
  return 60_000;
}

export class AllureApiClient {
  private readonly baseUrl: string;
  private readonly tokenManager: TokenManager;
  readonly defaultProjectId: number | undefined;
  private readonly maxGetRetries = 2;
  private readonly requestTimeoutMs = 30000;
  private readonly cache: CacheStore;

  constructor(options: AllureApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokenManager = options.tokenManager;
    this.defaultProjectId = options.defaultProjectId;
    this.cache = options.cache ?? new NullCacheStore();
  }

  async get<T>(path: string, query?: QueryParams): Promise<T> {
    const key = this.cacheKey(path, query);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      return hit as T;
    }
    const result = await this.request<T>("GET", path, undefined, query);
    if (result !== null && result !== undefined && typeof result === "object") {
      this.cache.set(key, result as object, getTtl(path));
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
    const accessToken = await this.tokenManager.getAccessToken();
    const url = this.buildUrl(path, query);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Allure API POST ${path} failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  }

  async getRaw(path: string, query?: QueryParams): Promise<{ contentType: string; content: string; encoding: string }> {
    const accessToken = await this.tokenManager.getAccessToken();
    const url = this.buildUrl(path, query);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Allure API GET ${path} failed (${response.status}): ${text}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const buffer = await response.arrayBuffer();
    const content = Buffer.from(buffer).toString("base64");

    return { contentType, content, encoding: "base64" };
  }

  private cacheKey(path: string, query?: QueryParams): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (!query) return normalized;
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${Array.isArray(v) ? (v as unknown[]).join(",") : v}`)
      .join("&");
    return params ? `${normalized}?${params}` : normalized;
  }

  private invalidateByPrefix(path: string): void {
    const base = path.replace(/\/\d+.*$/, "");
    this.cache.invalidateByPrefix(base);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: QueryParams,
  ): Promise<T> {
    if (method !== "GET") {
      this.invalidateByPrefix(path);
    }
    const accessToken = await this.tokenManager.getAccessToken();
    const url = this.buildUrl(path, query);
    const retries = method === "GET" ? this.maxGetRetries : 0;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < retries && this.isRetryableNetworkError(message)) {
          await this.wait(300 * (attempt + 1));
          continue;
        }
        throw error;
      }

      if (!response.ok) {
        const text = await response.text();
        const message = `Allure API ${method} ${path} failed (${response.status}): ${text}`;
        if (attempt < retries && [502, 503, 504].includes(response.status)) {
          await this.wait(300 * (attempt + 1));
          continue;
        }
        throw new Error(message);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return (await response.json()) as T;
      }

      return (await response.text()) as T;
    }

    throw new Error(`Allure API ${method} ${path} failed after retries.`);
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

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

  private isRetryableNetworkError(message: string): boolean {
    const lower = message.toLowerCase();
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
