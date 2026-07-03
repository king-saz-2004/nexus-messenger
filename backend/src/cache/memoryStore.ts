import type { CacheReadResult, CacheStore } from './cacheStore.js';

type MemoryEntry = {
  value: unknown;
  expiresAt: number;
  touchedAt: number;
};

export class MemoryCacheStore implements CacheStore {
  readonly provider = 'memory';

  private readonly maxEntries: number;
  private readonly defaultTtlSeconds: number;
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(params: { maxEntries: number; defaultTtlSeconds: number }) {
    this.maxEntries = params.maxEntries;
    this.defaultTtlSeconds = params.defaultTtlSeconds;
  }

  async get<T>(key: string): Promise<CacheReadResult<T>> {
    const found = this.entries.get(key);
    if (!found) return { hit: false };

    if (found.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return { hit: false };
    }

    found.touchedAt = Date.now();
    return { hit: true, value: found.value as T };
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.evictExpired();
    this.evictOverflow();

    const ttlMs = Math.max(1, ttlSeconds ?? this.defaultTtlSeconds) * 1000;
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      touchedAt: Date.now()
    });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.entries.clear();
  }

  private evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private evictOverflow() {
    if (this.entries.size < this.maxEntries) return;

    const staleEntries = [...this.entries.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    const removeCount = Math.max(1, staleEntries.length - this.maxEntries + 1);
    for (let index = 0; index < removeCount; index += 1) {
      this.entries.delete(staleEntries[index]![0]);
    }
  }
}

