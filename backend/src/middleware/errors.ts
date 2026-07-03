import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { getPgErrorCode } from '../utils/errors.js';
import { MediaFileTooLargeError } from '../services/mediaStorage.js';

export const notFound = (_req: Request, res: Response) => {
  return res.status(404).json({ message: 'Not found' });
};

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MediaFileTooLargeError) {
    return res.status(413).json({ message: err.message });
  }

  if ((err as Error & { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ message: 'Payload too large' });
  }

  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body')) {
    return res.status(400).json({ message: 'Malformed JSON payload' });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ message: 'Invalid input', issues: err.issues });
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      if (err.field === 'avatar') {
        return res.status(413).json({ message: 'Avatar is too large. Maximum upload size is 5MB' });
      }
      return res.status(413).json({ message: 'File is too large' });
    }
    return res.status(400).json({ message: 'Invalid upload payload' });
  }

  const pgCode = getPgErrorCode(err);
  if (pgCode) {
    if (pgCode === '23505') {
      return res.status(409).json({ message: 'Resource already exists' });
    }
    if (pgCode === '23503') {
      return res.status(400).json({ message: 'Resource reference invalid' });
    }
    if (pgCode === '23514') {
      return res.status(400).json({ message: 'Check constraint violation' });
    }
    return res.status(400).json({ message: 'Database request failed' });
  }

  const status = (err as Error & { status?: number }).status ?? 500;
  const isProduction = process.env.NODE_ENV === 'production';
  if (status >= 500) {
    logger.error('unhandled_error', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status,
      userId: req.user?.sub,
      error: err
    });
  }

  if (status >= 500 && isProduction) {
    return res.status(status).json({ message: 'Server error' });
  }
  return res.status(status).json({ message: err.message ?? 'Server error' });
};
