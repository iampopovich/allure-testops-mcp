import { beforeEach, describe, expect, it, vi } from "vitest";
import { Semaphore } from "../../src/rate-limiter.js";
import { AllureApiClient } from "../../src/client.js";
import { NullCacheStore } from "../../src/cache.js";
import { TokenManager } from "../../src/auth.js";

// ─── Semaphore ───────────────────────────────────────────────────────────────

describe("Semaphore", () => {
  describe("unlimited mode (max=0)", () => {
    it("acquire resolves immediately without limiting concurrency", async () => {
      const sem = new Semaphore(0);
      const start = Date.now();
      await sem.acquire();
      await sem.acquire();
      await sem.acquire();
      expect(Date.now() - start).toBeLessThan(50); // all resolve instantly
      expect(sem.current).toBe(0);
      expect(sem.queueLength).toBe(0);
    });

    it("release is a no-op and does not throw", () => {
      const sem = new Semaphore(0);
      expect(() => sem.release()).not.toThrow();
    });
  });

  describe("limited mode (max=3)", () => {
    let sem: Semaphore;

    beforeEach(() => {
      sem = new Semaphore(3);
    });

    it("allows up to max concurrent acquires", async () => {
      await sem.acquire();
      await sem.acquire();
      await sem.acquire();
      expect(sem.current).toBe(3);
      expect(sem.queueLength).toBe(0);
    });

    it("queues the 4th caller beyond max", async () => {
      await sem.acquire();
      await sem.acquire();
      await sem.acquire();

      let acquired = false;
      // 4th call — should queue
      const fourth = sem.acquire().then(() => { acquired = true; });

      // give microtask queue a chance
      await new Promise((r) => setTimeout(r, 10));
      expect(sem.current).toBe(3);
      expect(sem.queueLength).toBe(1);
      expect(acquired).toBe(false);

      // release one → fourth should be unblocked
      sem.release();
      await fourth;
      expect(acquired).toBe(true);
      expect(sem.current).toBe(3); // one left, one entered
    });

    it("release unblocks waiters in FIFO order", async () => {
      // fill all 3 slots
      await sem.acquire();
      await sem.acquire();
      await sem.acquire();

      const order: number[] = [];
      void sem.acquire().then(() => order.push(1));
      void sem.acquire().then(() => order.push(2));
      void sem.acquire().then(() => order.push(3));

      await new Promise((r) => setTimeout(r, 10));
      expect(sem.queueLength).toBe(3);

      sem.release(); // unblocks #1
      sem.release(); // unblocks #2
      sem.release(); // unblocks #3

      // Wait for microtask resolution
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual([1, 2, 3]);
    });

    it("exposes correct max value", () => {
      expect(sem.max).toBe(3);
    });

    it("negative max is treated as unlimited", () => {
      const sem2 = new Semaphore(-1);
      expect(sem2.max).toBe(-1);
      // acquire resolves instantly
      expect(() => sem2.acquire()).not.toThrow();
    });
  });
});

// ─── AllureApiClient rate-limit integration ──────────────────────────────────

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

function buildClient(maxConcurrent?: number) {
  const tokenManager = {
    getAccessToken: vi.fn().mockResolvedValue("tok"),
  } as unknown as TokenManager;

  return new AllureApiClient({
    baseUrl: "https://allure.test",
    tokenManager,
    cache: new NullCacheStore(), // disable GET caching so we count real calls
    maxConcurrent,
  });
}

describe("AllureApiClient — rate limiting", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
  });

  it("default (maxConcurrent=0 / unlimited) does not serialise requests", async () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const fetchMock = makeFetchMock(responses);
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(); // default maxConcurrent=0 → unlimited
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => client.get(`/api/testcase/${i}`)),
    );

    const elapsed = Date.now() - start;
    expect(results).toHaveLength(10);
    // With unlimited concurrency, all should fire roughly in parallel
    // (each mock resolves synchronously, so elapsed should be very small)
    expect(elapsed).toBeLessThan(500);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("with maxConcurrent=2, at most 2 requests run at a time", async () => {
    let concurrent = 0;
    let maxObserved = 0;
    const fetchMock = vi.fn(async () => {
      concurrent += 1;
      maxObserved = Math.max(maxObserved, concurrent);
      // small delay to simulate real I/O and give other tasks a chance
      await new Promise((r) => setTimeout(r, 20));
      concurrent -= 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(2);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => client.get(`/api/testcase/${i}`)),
    );

    expect(results).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // max concurrent should never exceed 2
    expect(maxObserved).toBe(2);
  });

  it("error releases semaphore — subsequent calls can proceed", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // Non-retryable error (not in the retryable list) — fails once and releases semaphore
        return {
          ok: false,
          status: 500,
          headers: { get: () => "text/plain" },
          text: async () => "internal error",
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ id: call }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(2);

    // First call — will fail
    const first = client.get("/api/testcase/1").catch((e) => e);
    // Second call — should succeed (permit was released)
    const second = client.get("/api/testcase/2");

    const [err, result] = await Promise.all([first, second]);
    expect(err).toBeInstanceOf(Error);
    expect(result).toEqual({ id: 2 });
  });

  it("POST is also rate-limited", async () => {
    let concurrent = 0;
    let maxObserved = 0;
    const fetchMock = vi.fn(async () => {
      concurrent += 1;
      maxObserved = Math.max(maxObserved, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent -= 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = buildClient(1);
    await Promise.all([
      client.post("/api/testcase", { name: "A" }),
      client.post("/api/testcase", { name: "B" }),
      client.post("/api/testcase", { name: "C" }),
    ]);

    expect(maxObserved).toBe(1);
  });
});
