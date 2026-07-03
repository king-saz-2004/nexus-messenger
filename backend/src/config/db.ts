import pg from 'pg';
import { env } from './env.js';
import type { SqlFragment } from './sql.js';
import { sql } from './sql.js';

// Setup connection config
const dbConfig: pg.PoolConfig = {
  connectionString: env.databaseUrl,
  max: env.dbConnectionLimit,
  idleTimeoutMillis: env.dbPoolTimeoutSeconds * 1000,
};

export const pool = new pg.Pool(dbConfig);

export const effectiveDatabaseUrl = env.databaseUrl;

export const connectDb = async () => {
  const client = await pool.connect();
  client.release();
};

export const stopDb = async () => {
  await pool.end();
};

export type DbExecutor = {
  $queryRaw<T = unknown[]>(query: SqlFragment): Promise<T>;
  $queryRaw<T = unknown[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;

  $executeRaw(query: SqlFragment): Promise<number>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

export type DbTransaction = DbExecutor;

const isSqlFragment = (val: unknown): val is SqlFragment => {
  return (
    typeof val === 'object' &&
    val !== null &&
    'text' in val &&
    'values' in val &&
    typeof (val as SqlFragment).text === 'string' &&
    Array.isArray((val as SqlFragment).values)
  );
};

export const createExecutor = (target: pg.Pool | pg.PoolClient): DbExecutor => {
  return {
    async $queryRaw<T = unknown[]>(
      queryOrStrings: SqlFragment | TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T> {
      let finalQuery: SqlFragment;
      if (isSqlFragment(queryOrStrings)) {
        finalQuery = queryOrStrings;
      } else {
        finalQuery = sql(queryOrStrings, ...values);
      }

      const res = await target.query(finalQuery.text, finalQuery.values);
      return res.rows as unknown as T;
    },

    async $executeRaw(
      queryOrStrings: SqlFragment | TemplateStringsArray,
      ...values: unknown[]
    ): Promise<number> {
      let finalQuery: SqlFragment;
      if (isSqlFragment(queryOrStrings)) {
        finalQuery = queryOrStrings;
      } else {
        finalQuery = sql(queryOrStrings, ...values);
      }

      const res = await target.query(finalQuery.text, finalQuery.values);
      return res.rowCount ?? 0;
    }
  };
};

export const $transaction = async <T>(
  handler: (tx: DbExecutor) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txExecutor = createExecutor(client);
    const result = await handler(txExecutor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const db: DbExecutor & {
  $transaction<T>(handler: (tx: DbExecutor) => Promise<T>): Promise<T>;
} = {
  ...createExecutor(pool),
  $transaction
};
