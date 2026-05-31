import { beforeEach, describe, expect, it, vi } from "vitest";
import { NullCacheStore, LruCacheStore } from "../../src/cache.js";
import { AllureApiClient } from "../../src/client.js";
import { TokenManager } from "../../src/auth.js";

// ─── NullCacheStore ──────────────────────────────────────────────────────────

describe("NullCacheStore", () => {
  it("get always returns undefined", () => {
    const store = new NullCacheStore();
    store.set("/key", { value: 1 }, 60_000);
    expect(store.get("/key")).toBeUndefined();
  });

  it("set and invalidateByPrefix are no-ops", () => {
    const store = new NullCacheStore();
    expect(() => {
      store.set("/key", { value: 1 }, 60_000);
      store.invalidateByPrefix("/key");
    }).not.toThrow();
  });
});

// ─── LruCacheStore ───────────────────────────────────────────────────────────

describe("LruCacheStore", () => {
  let store: LruCacheStore;

  beforeEach(() => {
    store = new LruCacheStore();
  });

  it("returns undefined for unknown key", () => {
    expect(store.get("/missing")).toBeUndefined();
  });

  it("stores and retrieves a value before TTL expires", () => {
    const value = { id: 42 };
    store.set("/api/testcase/42", value, 60_000);
    expect(store.get("/api/testcase/42")).toEqual(value);
  });

  it("returns undefined after TTL expires", async () => {
    store.set("/api/launch/1", { id: 1 }, 50);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(store.get("/api/launch/1")).toBeUndefined();
  });

  it("invalidateByPrefix removes matching keys and keeps others", () => {
    store.set("/api/launch/1", { id: 1 }, 60_000);
    store.set("/api/launch/2", { id: 2 }, 60_000);
    store.set("/api/testcase/10", { id: 10 }, 60_000);

    store.invalidateByPrefix("/api/launch");

    expect(store.get("/api/launch/1")).toBeUndefined();
    expect(store.get("/api/launch/2")).toBeUndefined();
    expect(store.get("/api/testcase/10")).toEqual({ id: 10 });
  });

  it("invalidateByPrefix is a no-op when no keys match", () => {
    store.set("/api/testcase/5", { id: 5 }, 60_000);
    expect(() => store.invalidateByPrefix("/api/launch")).not.toThrow();
    expect(store.get("/api/testcase/5")).toEqual({ id: 5 });
  });

  it("does not extend TTL on read (updateAgeOnGet: false)", async () => {
    store.set("/api/defect/1", { id: 1 }, 80);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.get("/api/defect/1")).toBeDefined(); // read — should NOT reset TTL

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(store.get("/api/defect/1")).toBeUndefined(); // total 110ms > 80ms TTL
  });

  it("overwrites an existing key with a new value", () => {
    store.set("/api/testcase/1", { version: 1 }, 60_000);
    store.set("/api/testcase/1", { version: 2 }, 60_000);
    expect(store.get("/api/testcase/1")).toEqual({ version: 2 });
  });
});

// ─── AllureApiClient cache integration ───────────────────────────────────────

function makeFetchMock(responses: object[]) {
  let call = 0;
  return vi.fn(async () => {
    const body = responses[call++ % responses.length];
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => body,
    } as unknown as Response;
  });
}

function buildClient(cacheOverride?: import("../../src/cache.js").CacheStore) {
  const tokenManager = { getAccessToken: vi.fn().mockResolvedValue("tok") } as unknown as TokenManager;
  return new AllureApiClient({
    baseUrl: "https://allure.test",
    tokenManager,
    cache: cacheOverride,
  });
}

describe("AllureApiClient — caching behaviour", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
  });

  it("returns cached result on second GET without making a second network call", async () => {
    const fetchMock = makeFetchMock([{ id: 1 }]);
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(new LruCacheStore());
    const first = await client.get("/api/testcase/1");
    const second = await client.get("/api/testcase/1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ id: 1 });
    expect(second).toEqual({ id: 1 });
  });

  it("makes a fresh network call after cache is invalidated by write", async () => {
    const fetchMock = makeFetchMock([{ id: 1 }, undefined, { id: 2 }]);
    vi.stubGlobal("fetch", fetchMock);

    const store = new LruCacheStore();
    const client = buildClient(store);

    const first = await client.get("/api/testcase/1");
    expect(first).toEqual({ id: 1 });

    // patch triggers invalidation of /api/testcase prefix
    await client.patch("/api/testcase/1", { name: "updated" });

    const afterWrite = await client.get("/api/testcase/1");
    expect(afterWrite).toEqual({ id: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // GET, PATCH, GET
  });

  it("different query params produce separate cache keys", async () => {
    const fetchMock = makeFetchMock([{ page: 1 }, { page: 2 }]);
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(new LruCacheStore());
    const page1 = await client.get("/api/testcase", { page: 1 });
    const page2 = await client.get("/api/testcase", { page: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page1).toEqual({ page: 1 });
    expect(page2).toEqual({ page: 2 });
  });

  it("same query params in different order produce the same cache key", async () => {
    const fetchMock = makeFetchMock([{ id: 5 }]);
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(new LruCacheStore());
    await client.get("/api/testcase", { projectId: 37, page: 0 });
    await client.get("/api/testcase", { page: 0, projectId: 37 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("with NullCacheStore (cache disabled) every GET hits the network", async () => {
    const fetchMock = makeFetchMock([{ id: 1 }, { id: 1 }]);
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(new NullCacheStore());
    await client.get("/api/testcase/1");
    await client.get("/api/testcase/1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("without explicit cache option defaults to NullCacheStore (no caching)", async () => {
    const fetchMock = makeFetchMock([{ id: 1 }, { id: 1 }]);
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(); // no cache option
    await client.get("/api/testcase/1");
    await client.get("/api/testcase/1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("POST does not cache and invalidates existing entries under the same prefix", async () => {
    const fetchMock = makeFetchMock([{ id: 10 }, { id: 11 }, { id: 10 }]);
    vi.stubGlobal("fetch", fetchMock);

    const store = new LruCacheStore();
    const client = buildClient(store);

    await client.get("/api/launch/10");   // cached
    await client.post("/api/launch", { name: "new" });  // invalidates /api/launch prefix
    const afterPost = await client.get("/api/launch/10"); // should re-fetch

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(afterPost).toEqual({ id: 10 });
  });
});
