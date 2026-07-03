import { Buffer } from 'node:buffer';

export const parseLimit = (raw: unknown, defaults: { fallback: number; min: number; max: number }) => {
  if (raw === undefined) return defaults.fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return defaults.fallback;
  if (parsed < defaults.min) return defaults.min;
  if (parsed > defaults.max) return defaults.max;
  return parsed;
};

export const encodeCursor = (payload: Record<string, unknown>) => {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

export const decodeCursor = <T extends Record<string, unknown>>(cursor: string | undefined | null): T | null => {
  if (!cursor || typeof cursor !== 'string') return null;

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
};

export const toPaginationResult = <T>(
  rows: T[],
  limit: number,
  makeCursor: (row: T) => string
): { items: T[]; nextCursor?: string; hasMore: boolean } => {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && lastItem ? makeCursor(lastItem) : undefined,
    hasMore
  };
};

export const paginateArrayByCursor = <T>(rows: T[], params: {
  limit: number;
  cursor?: string | null;
  extractCursor: (row: T) => string;
}) => {
  const startIndex =
    params.cursor && params.cursor.length > 0
      ? Math.max(
          0,
          rows.findIndex(row => params.extractCursor(row) === params.cursor) + 1
        )
      : 0;

  const window = rows.slice(startIndex, startIndex + params.limit + 1);
  const hasMore = window.length > params.limit;
  const items = hasMore ? window.slice(0, params.limit) : window;
  const nextCursor = hasMore && items.length > 0 ? params.extractCursor(items[items.length - 1]!) : undefined;

  return { items, nextCursor, hasMore };
};
