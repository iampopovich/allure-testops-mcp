import { LRUCache } from "lru-cache";

export interface CacheStore {
  get(key: string): object | undefined;
  set(key: string, value: object, ttlMs: number): void;
  invalidateByPrefix(prefix: string): void;
}

export class NullCacheStore implements CacheStore {
  get(_key: string): object | undefined { return undefined; }
  set(_key: string, _value: object, _ttlMs: number): void {}
  invalidateByPrefix(_prefix: string): void {}
}

export class LruCacheStore implements CacheStore {
  private readonly lru = new LRUCache<string, object>({
    max: 500,
    allowStale: false,
    updateAgeOnGet: false,
  });

  get(key: string): object | undefined {
    return this.lru.get(key);
  }

  set(key: string, value: object, ttlMs: number): void {
    this.lru.set(key, value, { ttl: ttlMs });
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.lru.keys()) {
      if (key.startsWith(prefix)) {
        this.lru.delete(key);
      }
    }
  }
}
