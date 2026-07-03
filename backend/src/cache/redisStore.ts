import { createClient, type RedisClientType } from 'redis';
import type { CacheReadResult, CacheStore } from './cacheStore.js';

export class RedisCacheStore implements CacheStore {
  readonly provider = 'redis';
  private readonly client: RedisClientType;
  private readonly defaultTtlSeconds: number;

  constructor(params: { redisUrl: string; defaultTtlSeconds: number }) {
    this.defaultTtlSeconds = params.defaultTtlSeconds;
    this.client = createClient({
      url: params.redisUrl,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: retries => Math.min(500, retries * 50)
      }
    });
    // Prevent unhandled Redis client errors from terminating the process.
    this.client.on('error', () => undefined);
  }

  private ensureReady() {
    if (!this.client.isReady) {
      throw new Error('Redis client is not ready');
    }
  }

  async connect() {
    await this.client.connect();
    await this.client.ping();
  }

  async get<T>(key: string): Promise<CacheReadResult<T>> {
    this.ensureReady();
    const raw = await this.client.get(key);
    if (!raw) return { hit: false };

    try {
      return { hit: true, value: JSON.parse(raw) as T };
    } catch {
      await this.client.del(key);
      return { hit: false };
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.ensureReady();
    await this.client.set(key, JSON.stringify(value), {
      EX: Math.max(1, ttlSeconds ?? this.defaultTtlSeconds)
    });
  }

  async del(key: string): Promise<void> {
    this.ensureReady();
    await this.client.del(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    this.ensureReady();
    let cursor = '0';
    do {
      const result = await this.client.scan(cursor, {
        MATCH: `${prefix}*`,
        COUNT: 200
      });
      cursor = result.cursor;
      const keys = result.keys;
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } while (cursor !== '0');
  }

  async shutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }
}
