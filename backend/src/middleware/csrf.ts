import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_POST_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh']);

const getHeaderToken = (req: Request) => {
  const raw = req.get('x-csrf-token');
  if (typeof raw !== 'string') return '';
  return raw.trim();
};

const isExemptRequest = (req: Request) => {
  if (req.method.toUpperCase() !== 'POST') return false;
  return CSRF_EXEMPT_POST_PATHS.has(req.path);
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method) || isExemptRequest(req)) {
    return next();
  }

  const cookieToken = (req.cookies?.[env.csrfCookieName] ?? '').toString().trim();
  const headerToken = getHeaderToken(req);
  if (!cookieToken || !headerToken) {
    return res.status(403).json({ message: 'Missing CSRF token' });
  }

  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }

  return next();
};

