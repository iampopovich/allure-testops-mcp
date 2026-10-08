import { afterEach, describe, expect, it, vi } from "vitest";
import { AllureApiClient } from "../../src/client.js";
import { LruCacheStore } from "../../src/cache.js";
import { TokenManager } from "../../src/auth.js";
import { inferToolAnnotations, coerceObject } from "../../src/tools/schema.js";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeTokenManager(overrides: Partial<Record<"getAccessToken" | "invalidate", unknown>> = {}): TokenManager {
  let n = 0;
  return {
    getAccessToken: vi.fn(async () => "tok" + (++n)),
    invalidate: vi.fn(),
    ...overrides,
  } as unknown as TokenManager;
}

/** Fake server whose state version increments on every non-GET request. */
function versionedFetch() {
  let version = 1;
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method !== "GET") version += 1;
    return json({ v: version });
  });
}

function buildClient(options: Partial<ConstructorParameters<typeof AllureApiClient>[0]> = {}) {
  return new AllureApiClient({
    baseUrl: "https://allure.test",
    tokenManager: fakeTokenManager(),
    ...options,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AllureApiClient — cache invalidation", () => {
  it.each([
    ["/api/testcase/step", "/api/testcase/42/step"],
    ["/api/testcase/step/7", "/api/testcase/42/step"],
    ["/api/v2/test-case/bulk/tag/add", "/api/testcase/42/tag"],
    ["/api/v2/test-case/bulk/cfv/add", "/api/testcase/42/cfv"],
    ["/api/launch/1/testcase/add", "/api/launch/1/statistic"],
  ])("write to %s refreshes cached %s", async (writePath, readPath) => {
    vi.stubGlobal("fetch", versionedFetch());
    const client = buildClient({ cache: new LruCacheStore() });

    const before = await client.get<{ v: number }>(readPath);
    await client.post(writePath, {});
    const after = await client.get<{ v: number }>(readPath);

    expect(after.v).not.toBe(before.v);
  });

  it("keeps write-safe reference data cached across writes", async () => {
    const fetchMock = vi.fn(async () => json({ content: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = buildClient({ cache: new LruCacheStore() });

    await client.get("/api/project/suggest", { query: "a" });
    await client.post("/api/testcase", {});
    await client.get("/api/project/suggest", { query: "a" });

    expect(fetchMock).toHaveBeenCalledTimes(2); // GET + POST, second GET served from cache
  });

  it("invalidates after a multipart upload", async () => {
    vi.stubGlobal("fetch", versionedFetch());
    const client = buildClient({ cache: new LruCacheStore() });

    const before = await client.get<{ v: number }>("/api/testcase/attachment", { testCaseId: 1 });
    await client.postMultipart("/api/testcase/attachment", new FormData());
    const after = await client.get<{ v: number }>("/api/testcase/attachment", { testCaseId: 1 });

    expect(after.v).not.toBe(before.v);
  });

  it("invalidates even when the write fails", async () => {
    let version = 1;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "GET") {
        version += 1;
        return json({ error: "boom" }, 500);
      }
      return json({ v: version });
    }));
    const client = buildClient({ cache: new LruCacheStore() });

    const before = await client.get<{ v: number }>("/api/testcase/9");
    await expect(client.patch("/api/testcase/9", {})).rejects.toThrow("failed (500)");
    const after = await client.get<{ v: number }>("/api/testcase/9");

    expect(after.v).not.toBe(before.v);
  });

  it("does not cache a GET that overlapped a write", async () => {
    let version = 1;
    let releaseSlowGet!: () => void;
    const gate = new Promise<void>((resolve) => (releaseSlowGet = resolve));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "GET" && version === 1) {
        await gate;
        return json({ v: 1 });
      }
      if (init.method !== "GET") version += 1;
      return json({ v: version });
    }));
    const client = buildClient({ cache: new LruCacheStore() });

    const slow = client.get<{ v: number }>("/api/testcase/1/step");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await client.post("/api/testcase/step", {});
    releaseSlowGet();
    await slow;

    const after = await client.get<{ v: number }>("/api/testcase/1/step");
    expect(after.v).toBe(2);
  });

  it("isolates cached values from caller mutation", async () => {
    const fetchMock = vi.fn(async () => json({ nested: { value: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = buildClient({ cache: new LruCacheStore() });

    const first = await client.get<{ nested: { value: number } }>("/api/testcase/1");
    first.nested.value = 99;
    const second = await client.get<{ nested: { value: number } }>("/api/testcase/1");
    second.nested.value = 77;
    const third = await client.get<{ nested: { value: number } }>("/api/testcase/1");

    expect(third.nested.value).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("AllureApiClient — retries and auth", () => {
  it("refreshes the token once on 401 and retries (writes included)", async () => {
    const auth: string[] = [];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      auth.push((init.headers as Record<string, string>).Authorization);
      call += 1;
      return call === 1 ? json({}, 401) : json({ ok: true });
    }));
    const tokenManager = fakeTokenManager();
    const client = buildClient({ tokenManager });

    const result = await client.post<{ ok: boolean }>("/api/testcase", {});

    expect(result).toEqual({ ok: true });
    expect(auth).toEqual(["Bearer tok1", "Bearer tok2"]);
    expect(tokenManager.invalidate).toHaveBeenCalledWith("tok1");
  });

  it("surfaces a persistent 401 after one refresh", async () => {
    const fetchMock = vi.fn(async () => json({ error: "nope" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const client = buildClient();

    await expect(client.get("/api/x")).rejects.toThrow("Allure API GET /api/x failed (401): ");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 429 honoring Retry-After, for writes too", async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetchMock = vi.fn(async () => (++call === 1 ? json({}, 429, { "retry-after": "2" }) : json({ ok: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    const client = buildClient();

    const pending = client.post("/api/testcase", {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx only for GET", async () => {
    const fetchMock = vi.fn(async () => json({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    const client = buildClient();

    await expect(client.post("/api/testcase", {})).rejects.toThrow("failed (503)");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await expect(client.get("/api/testcase")).rejects.toThrow("failed (503)");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats AbortSignal timeouts as retryable for GET but not for writes", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      if (call < 3) throw timeout;
      return json({ ok: 1 });
    }));
    const client = buildClient();
    await expect(client.get("/api/a")).resolves.toEqual({ ok: 1 });
    expect(call).toBe(3);

    const writeFetch = vi.fn(async () => { throw timeout; });
    vi.stubGlobal("fetch", writeFetch);
    await expect(client.post("/api/a", {})).rejects.toBe(timeout);
    expect(writeFetch).toHaveBeenCalledTimes(1);
  });

  it("releases the concurrency permit during retry back-off", async () => {
    const order: string[] = [];
    let aCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      order.push(path);
      if (path === "/a" && ++aCalls === 1) return json({}, 503);
      return json({ path });
    }));
    const client = buildClient({ maxConcurrent: 1 });

    await Promise.all([
      client.get("/a"),
      new Promise((resolve) => setTimeout(resolve, 20)).then(() => client.get("/b")),
    ]);

    expect(order).toEqual(["/a", "/b", "/a"]);
  });

  it("getRaw returns base64 content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    })));
    const client = buildClient();

    await expect(client.getRaw("/api/testcase/attachment/1/content")).resolves.toEqual({
      contentType: "image/png",
      content: "AQID",
      encoding: "base64",
    });
  });
});

describe("TokenManager", () => {
  it("passes a timeout signal to the token exchange and honors invalidate()", async () => {
    let signal: AbortSignal | null | undefined;
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal;
      call += 1;
      return json({ access_token: "jwt" + call, token_type: "bearer", expires_in: 3600 });
    }));
    const tokenManager = new TokenManager({ baseUrl: "https://allure.test", apiToken: "api" });

    const first = await tokenManager.getAccessToken();
    expect(signal).toBeInstanceOf(AbortSignal);

    tokenManager.invalidate("some-other-token");
    await expect(tokenManager.getAccessToken()).resolves.toBe(first);
    expect(call).toBe(1);

    tokenManager.invalidate(first);
    await expect(tokenManager.getAccessToken()).resolves.toBe("jwt2");
    expect(call).toBe(2);
  });
});

describe("tool schema helpers", () => {
  it.each([
    ["get_test_case", { readOnlyHint: true }],
    ["search_launches", { readOnlyHint: true }],
    ["delete_launch", { readOnlyHint: false, destructiveHint: true }],
    ["remove_test_case_tags_bulk", { readOnlyHint: false, destructiveHint: true }],
    ["create_test_case", { readOnlyHint: false, destructiveHint: false }],
  ])("inferToolAnnotations(%s)", (name, expected) => {
    expect(inferToolAnnotations(name)).toMatchObject(expected);
  });

  it("leaves destructiveHint unset for replace-style writes", () => {
    expect(inferToolAnnotations("update_test_case").destructiveHint).toBeUndefined();
    expect(inferToolAnnotations("set_test_case_tags").readOnlyHint).toBe(false);
  });

  it("coerceObject parses JSON strings and rejects malformed ones", () => {
    const schema = coerceObject();
    expect(schema.parse('{"name":"x"}')).toEqual({ name: "x" });
    expect(schema.parse({ name: "y" })).toEqual({ name: "y" });
    expect(() => schema.parse("{not json")).toThrow("Expected an object or a JSON-encoded object string.");
  });
});
