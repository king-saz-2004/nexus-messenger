export type CacheReadResult<T> =
  | {
      hit: true;
      value: T;
    }
  | {
      hit: false;
    };

export interface CacheStore {
  readonly provider: string;
  get<T>(key: string): Promise<CacheReadResult<T>>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
  shutdown(): Promise<void>;
}

