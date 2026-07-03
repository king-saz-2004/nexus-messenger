import type { NextFunction, Request, Response } from 'express';
import type { CorsOptions } from 'cors';
import helmet from 'helmet';
import { env, normalizeOrigin } from '../config/env.js';

const allowedOrigins = new Set(env.clientOrigins);
type OriginCallback = (error: Error | null, allow?: boolean) => void;

const SAFE_CORS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const createCorsOriginValidator = () => {
  return (origin: string | undefined, callback: OriginCallback) => {
    // Allow same-origin requests (browser doesn't send Origin for GET/HEAD/OPTIONS
    // from the same origin). Mutation requests without Origin are blocked by
    // requestGuards.ts as a secondary defence.
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    const error = new Error('Origin not allowed by CORS') as Error & { status?: number };
    error.status = 403;
    callback(error);
  };
};

export const corsOptions: CorsOptions = {
  origin: createCorsOriginValidator(),
  credentials: true,
  optionsSuccessStatus: 204
};

export const socketCorsOptions = {
  origin: createCorsOriginValidator(),
  credentials: true
} as const;

const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  xContentTypeOptions: true,
  strictTransportSecurity:
    env.nodeEnv === 'production' && env.strictProductionSecurity
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true
        }
      : false
});

const apiPermissionsPolicy =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(), accelerometer=(), gyroscope=()';
const frontendPermissionsPolicy =
  'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), fullscreen=(), accelerometer=(), gyroscope=()';

const apiRoutePrefixes = [
  '/auth',
  '/users',
  '/contacts',
  '/chats',
  '/groups',
  '/messages',
  '/media',
  '/avatars',
  '/health',
  '/socket.io',
  '/admin',
  '/link-preview'
];

const apiCsp = "default-src 'none';base-uri 'none';frame-ancestors 'none';form-action 'none'";

const buildFrontendCsp = () => {
  const isProd = env.nodeEnv === 'production';
  const connectOrigins = ["'self'", 'ws:', 'wss:'];
  for (const origin of env.clientOrigins) {
    if (origin && origin !== '*' && !connectOrigins.includes(origin)) {
      connectOrigins.push(origin);
    }
  }

  const imgSources = ["'self'", 'data:', 'blob:'];
  const mediaSources = ["'self'", 'data:', 'blob:'];

  if (!isProd) {
    imgSources.push('https:', 'http:');
    mediaSources.push('https:', 'http:');
    connectOrigins.push('https:', 'http:');
  } else {
    for (const origin of env.clientOrigins) {
      if (origin && origin !== '*' && !origin.startsWith('ws') && !origin.includes('localhost')) {
        imgSources.push(origin);
        mediaSources.push(origin);
      }
    }
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSources.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connectOrigins.join(' ')}`,
    `media-src ${mediaSources.join(' ')}`,
    "worker-src 'self' blob:",
  ].join(';');
};

const frontendCsp = buildFrontendCsp();

const isApiRequest = (req: Request) =>
  apiRoutePrefixes.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`));

export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  helmetMiddleware(req, res, error => {
    if (error) {
      next(error);
      return;
    }
    const apiRequest = isApiRequest(req);
    res.setHeader('Content-Security-Policy', apiRequest ? apiCsp : frontendCsp);
    res.setHeader('Permissions-Policy', apiRequest ? apiPermissionsPolicy : frontendPermissionsPolicy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
};
