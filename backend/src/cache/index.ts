import type { Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { CacheStore } from './cacheStore.js';
import { MemoryCacheStore } from './memoryStore.js';
import { RedisCacheStore } from './redisStore.js';

let store: CacheStore | null = null;
let fallbackStore: MemoryCacheStore | null = null;

const createMemoryStore = () =>
  new MemoryCacheStore({
    maxEntries: env.cacheMaxEntries,
    defaultTtlSeconds: env.cacheDefaultTtlSeconds
  });

const wrapWithFallback = (primary: CacheStore, fallback: MemoryCacheStore): CacheStore => {
  let degraded = false;

  const switchToFallback = (operation: string, error: unknown) => {
    if (!degraded) {
      degraded = true;
      store = fallback;
      logger.warn('cache_runtime_fallback_memory', {
        operation,
        provider: primary.provider,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return fallback;
  };

  return {
    get provider() {
      return degraded ? fallback.provider : primary.provider;
    },
    async get<T>(key: string) {
      if (degraded) return fallback.get<T>(key);
      try {
        return await primary.get<T>(key);
      } catch (error) {
        return switchToFallback('get', error).get<T>(key);
      }
    },
    async set<T>(key: string, value: T, ttlSeconds?: number) {
      if (degraded) {
        await fallback.set(key, value, ttlSeconds);
        return;
      }
      try {
        await primary.set(key, value, ttlSeconds);
      } catch (error) {
        await switchToFallback('set', error).set(key, value, ttlSeconds);
      }
    },
    async del(key: string) {
      if (degraded) {
        await fallback.del(key);
        return;
      }
      try {
        await primary.del(key);
      } catch (error) {
        await switchToFallback('del', error).del(key);
      }
    },
    async delByPrefix(prefix: string) {
      if (degraded) {
        await fallback.delByPrefix(prefix);
        return;
      }
      try {
        await primary.delByPrefix(prefix);
      } catch (error) {
        await switchToFallback('delByPrefix', error).delByPrefix(prefix);
      }
    },
    async shutdown() {
      if (degraded) {
        await fallback.shutdown();
        return;
      }
      await Promise.allSettled([primary.shutdown(), fallback.shutdown()]);
    }
  };
};

export const initCache = async () => {
  if (store) return store;

  if (env.cacheProvider === 'memory') {
    store = createMemoryStore();
    logger.info('cache_initialized', { provider: store.provider });
    return store;
  }

  const redisStore = new RedisCacheStore({
    redisUrl: env.redisUrl,
    defaultTtlSeconds: env.cacheDefaultTtlSeconds
  });

  try {
    await redisStore.connect();
    if (env.cacheFallbackToMemory) {
      fallbackStore = createMemoryStore();
      store = wrapWithFallback(redisStore, fallbackStore);
    } else {
      store = redisStore;
    }
    logger.info('cache_initialized', {
      provider: store.provider,
      redisUrl: env.redisUrl,
      fallbackEnabled: env.cacheFallbackToMemory
    });
    return store;
  } catch (error) {
    if (!env.cacheFallbackToMemory) {
      throw error;
    }

    logger.warn('cache_redis_unavailable_fallback_memory', {
      redisUrl: env.redisUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    fallbackStore = createMemoryStore();
    store = fallbackStore;
    return store;
  }
};

export const getCache = () => {
  if (!store) {
    throw new Error('Cache store not initialized');
  }
  return store;
};

export const shutdownCache = async () => {
  if (!store) return;
  await store.shutdown();
  store = null;
  fallbackStore = null;
};

export const cached = async <T>(params: {
  key: string;
  ttlSeconds: number;
  res?: Response;
  onMiss: () => Promise<T>;
  shouldCache?: (value: T) => boolean;
}) => {
  const cache = getCache();
  const hit = await cache.get<T>(params.key);
  if (hit.hit) {
    params.res?.setHeader('X-Cache', 'HIT');
    return hit.value;
  }

  params.res?.setHeader('X-Cache', 'MISS');
  const value = await params.onMiss();
  if (!params.shouldCache || params.shouldCache(value)) {
    await cache.set(params.key, value, params.ttlSeconds);
  }
  return value;
};
