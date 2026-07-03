import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger.js';

const requestIdPattern = /^[A-Za-z0-9\-_.]{8,128}$/;

const getRequestId = (req: Request) => {
  const header = req.headers['x-request-id'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === 'string' && requestIdPattern.test(raw)) {
    return raw;
  }
  return randomUUID();
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const requestId = getRequestId(req);
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    const status = res.statusCode;
    if (status < 500) return;

    logger.error('request_failed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status,
      userId: req.user?.sub,
      durationMs: Date.now() - startedAt,
      ip: req.ip
    });
  });

  next();
};

