import type { Request, Response } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env.js';

const getIpKey = (req: Request) => {
  const rawIp = req.ip?.trim();
  if (!rawIp) return 'ip:unknown';
  return `ip:${rawIp}`;
};

const getLoginIdentifier = (req: Request) => {
  if (!req.body || typeof req.body !== 'object') return 'username:unknown';
  const payload = req.body as Record<string, unknown>;
  const rawUsername = payload.username;
  if (typeof rawUsername !== 'string') return 'username:unknown';
  const normalized = rawUsername.trim().toLowerCase();
  if (!normalized) return 'username:unknown';
  return `username:${normalized}`;
};

const getLoginKey = (req: Request) => `${getIpKey(req)}:${getLoginIdentifier(req)}`;

const getActorKey = (req: Request) => {
  if (req.user?.sub) {
    return `user:${req.user.sub}`;
  }

  return getIpKey(req);
};

const getRetryAfterSeconds = (req: Request) => {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  if (!resetTime) return undefined;
  const deltaMs = resetTime.getTime() - Date.now();
  if (deltaMs <= 0) return 1;
  return Math.max(1, Math.ceil(deltaMs / 1000));
};

const buildRateLimiter = ({
  windowMs,
  limit,
  keyGenerator,
  skip,
  scope,
  skipSuccessfulRequests = false
}: {
  windowMs: number;
  limit: number;
  keyGenerator: (req: Request) => string;
  skip?: (req: Request) => boolean;
  scope: string;
  skipSuccessfulRequests?: boolean;
}): RateLimitRequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    skip,
    skipSuccessfulRequests,
    handler: (req: Request, res: Response) => {
      const retryAfter = getRetryAfterSeconds(req);
      if (retryAfter !== undefined) {
        res.setHeader('Retry-After', retryAfter.toString());
      }
      return res.status(429).json({
        message: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        scope,
        ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
      });
    }
  });

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const globalRateLimiter = buildRateLimiter({
  windowMs: env.globalRateLimitWindowMs,
  limit: env.globalRateLimitMax,
  keyGenerator: getIpKey,
  skip: req => req.path === '/health',
  scope: 'global'
});

export const authRateLimiter = buildRateLimiter({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  keyGenerator: getIpKey,
  scope: 'auth'
});

export const loginRateLimiter = buildRateLimiter({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  keyGenerator: getLoginKey,
  scope: 'auth_login',
  skipSuccessfulRequests: true
});

export const userLookupRateLimiter = buildRateLimiter({
  windowMs: env.userLookupRateLimitWindowMs,
  limit: env.userLookupRateLimitMax,
  keyGenerator: getActorKey,
  scope: 'user_lookup'
});

export const mutationRateLimiter = buildRateLimiter({
  windowMs: env.globalRateLimitWindowMs,
  limit: Math.max(20, Math.floor(env.globalRateLimitMax * 0.6)),
  keyGenerator: getActorKey,
  skip: req => !WRITE_METHODS.has(req.method.toUpperCase()),
  scope: 'mutation'
});

export const uploadRateLimiter = buildRateLimiter({
  windowMs: env.uploadRateLimitWindowMs,
  limit: env.uploadRateLimitMax,
  keyGenerator: getActorKey,
  skip: req => !['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase()),
  scope: 'upload'
});

export const linkPreviewRateLimiter = buildRateLimiter({
  windowMs: env.linkPreviewRateLimitWindowMs,
  limit: env.linkPreviewRateLimitMax,
  keyGenerator: getActorKey,
  scope: 'link_preview'
});
