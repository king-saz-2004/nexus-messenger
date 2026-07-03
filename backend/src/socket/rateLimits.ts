import type { Socket } from 'socket.io';
import { env } from '../config/env.js';
import { socketEventCounters, userEventCounters } from './state.js';
import type { Ack, RateCounter } from './types.js';

const RATE_LIMIT_CODE = 'RATE_LIMITED';
const SOCKET_RATE_WINDOW_MS = {
  typing: 10_000,
  presence: 60_000,
  joinLeave: 60_000,
  markRead: 60_000
} as const;
const SOCKET_RATE_LIMITS = {
  typing: env.socketTypingLimitPer10s,
  presence: env.socketPresenceLimitPerMin,
  joinLeave: env.socketJoinLeaveLimitPerMin,
  markRead: env.socketMarkReadLimitPerMin
} as const;

type RateBucket = keyof typeof SOCKET_RATE_WINDOW_MS;

const maybeCleanupCounterStore = (store: Map<string, RateCounter>, force = false) => {
  if (!force && store.size < 5000) return;
  const now = Date.now();
  for (const [key, state] of store) {
    if (state.resetAt <= now) {
      store.delete(key);
    }
  }
};

const consumeRateCounter = (
  store: Map<string, RateCounter>,
  key: string,
  maxEvents: number,
  windowMs: number
) => {
  maybeCleanupCounterStore(store);
  const now = Date.now();
  const state = store.get(key);
  if (!state || state.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (state.count >= maxEvents) {
    return false;
  }

  state.count += 1;
  return true;
};

export const isSocketEventRateLimited = (socketId: string, userId: string, bucket: RateBucket) => {
  const maxEvents = SOCKET_RATE_LIMITS[bucket];
  const windowMs = SOCKET_RATE_WINDOW_MS[bucket];
  const socketAllowed = consumeRateCounter(socketEventCounters, `${socketId}:${bucket}`, maxEvents, windowMs);
  if (!socketAllowed) return true;
  const userAllowed = consumeRateCounter(userEventCounters, `${userId}:${bucket}`, maxEvents, windowMs);
  return !userAllowed;
};

export const respondRateLimited = (socket: Socket, ack: Ack | undefined) => {
  ack?.({ ok: false, message: 'Rate limit exceeded', code: RATE_LIMIT_CODE });
  socket.emit('error', { message: 'Rate limit exceeded', code: RATE_LIMIT_CODE });
};

export const clearSocketRateCounters = (socketId: string) => {
  for (const key of socketEventCounters.keys()) {
    if (key.startsWith(`${socketId}:`)) {
      socketEventCounters.delete(key);
    }
  }
};

export const cleanupRateCounters = () => {
  maybeCleanupCounterStore(socketEventCounters, true);
  maybeCleanupCounterStore(userEventCounters, true);
};
