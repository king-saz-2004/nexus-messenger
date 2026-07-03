import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_URL_LENGTH = 4096;
const MAX_QUERY_LENGTH = 2048;
const allowedOrigins = new Set(env.clientOrigins);

const ALLOWED_CONTENT_TYPES = [
  /^application\/json\b/i,
  /^application\/x-www-form-urlencoded\b/i,
  /^multipart\/form-data\b/i
];

const hasRequestBody = (req: Request) => {
  const contentLengthRaw = req.headers['content-length'];
  const transferEncoding = req.headers['transfer-encoding'];
  if (typeof transferEncoding === 'string' && transferEncoding.trim().length > 0) {
    return true;
  }

  if (typeof contentLengthRaw === 'string') {
    const parsed = Number(contentLengthRaw);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
};

export const requestGuards = (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();
  const originalUrl = req.originalUrl || req.url || '';

  if (originalUrl.length > MAX_URL_LENGTH) {
    return res.status(414).json({ message: 'Request URL is too long' });
  }

  const queryIndex = originalUrl.indexOf('?');
  if (queryIndex >= 0) {
    const queryLength = originalUrl.length - queryIndex - 1;
    if (queryLength > MAX_QUERY_LENGTH) {
      return res.status(414).json({ message: 'Query string is too long' });
    }
  }

  const bodyPresent = hasRequestBody(req);
  if (bodyPresent && SAFE_METHODS.has(method)) {
    return res.status(400).json({ message: 'Request body is not allowed for this method' });
  }

  if (bodyPresent && WRITE_METHODS.has(method)) {
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string' || contentType.trim().length === 0) {
      return res.status(415).json({ message: 'Missing Content-Type header' });
    }

    const isAllowed = ALLOWED_CONTENT_TYPES.some(pattern => pattern.test(contentType));
    if (!isAllowed) {
      return res.status(415).json({ message: 'Unsupported Content-Type' });
    }
  }

  if (WRITE_METHODS.has(method)) {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.trim().length === 0) {
      return res.status(403).json({ message: 'Cross-site request blocked' });
    }

    if (!allowedOrigins.has(origin.trim())) {
      return res.status(403).json({ message: 'Cross-site request blocked' });
    }

    const fetchSite = req.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string') {
      const normalized = fetchSite.trim().toLowerCase();
      if (!['same-origin', 'same-site', 'none'].includes(normalized)) {
        return res.status(403).json({ message: 'Cross-site request blocked' });
      }
    }
  }

  return next();
};
