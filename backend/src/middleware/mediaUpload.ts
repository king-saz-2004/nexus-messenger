import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import {
  MEDIA_ROOT_DIR,
  ensureMediaRootExists,
  isAllowedMediaMime,
  gbToBytes,
  getLimitKeyForUpload,
  MediaFileTooLargeError,
  doesKindConflictWithDetectedType
} from '../services/mediaStorage.js';
import { getMediaLimits } from '../services/appSettings.js';
import { createHttpError } from '../utils/errors.js';

ensureMediaRootExists();

const extractSafeExtension = (originalName: string) => {
  const extension = path.extname(originalName).toLowerCase().slice(0, 12);
  return /^\.[a-z0-9]+$/.test(extension) ? extension : '';
};

class LimitedDiskStorage implements multer.StorageEngine {
  constructor(private destination: string) {}

  _handleFile(
    req: Request,
    file: Express.Multer.File,
    cb: (error?: any, info?: Partial<Express.Multer.File>) => void
  ) {
    const kind = req.body.kind;
    if (!kind) {
      cb(createHttpError(400, "Missing required 'kind' field"));
      return;
    }
    if (kind !== 'voice' && kind !== 'audio' && kind !== 'photo' && kind !== 'video') {
      cb(createHttpError(400, "Invalid 'kind' field"));
      return;
    }

    getMediaLimits()
      .then((limits) => {
        const limitKey = getLimitKeyForUpload(file.mimetype, kind);
        const gbLimit = limits[limitKey];
        const maxBytes = gbToBytes(gbLimit);

        const extension = extractSafeExtension(file.originalname);
        const filename = `${Date.now()}-${randomUUID()}${extension}`;
        const finalPath = path.join(this.destination, filename);

        const outStream = fs.createWriteStream(finalPath);
        
        let bytesWritten = 0;
        let isAborted = false;
        const sniffBuffer: Buffer[] = [];
        let sniffedBytes = 0;
        let sniffed = false;

        const cleanupAndError = (err: any) => {
          if (isAborted) return;
          isAborted = true;
          
          outStream.destroy();
          file.stream.destroy();
          
          fs.unlink(finalPath, () => {
            cb(err);
          });
        };

        outStream.on('error', (err) => {
          cleanupAndError(err);
        });

        const limitChecker = new Transform({
          async transform(chunk, encoding, callback) {
            bytesWritten += chunk.length;
            if (bytesWritten > maxBytes) {
              const maxMb = Math.round(gbLimit * 1000);
              callback(new MediaFileTooLargeError(limitKey, maxBytes, maxMb));
              return;
            }

            if (!sniffed) {
              if (sniffedBytes < 4100) {
                sniffBuffer.push(chunk);
                sniffedBytes += chunk.length;
              }

              if (sniffedBytes >= 4100) {
                sniffed = true;
                const fullBuffer = Buffer.concat(sniffBuffer);
                try {
                  const detected = await fileTypeFromBuffer(fullBuffer).catch(() => undefined);
                  if (!detected) {
                    callback(createHttpError(400, 'Invalid media file signature'));
                    return;
                  }
                  if (doesKindConflictWithDetectedType(kind, detected.mime)) {
                    callback(createHttpError(400, 'Media MIME type does not match file content'));
                    return;
                  }
                } catch (err) {
                  callback(err as any);
                  return;
                }
              }
            }

            callback(null, chunk);
          },
          async flush(callback) {
            if (!sniffed) {
              sniffed = true;
              const fullBuffer = Buffer.concat(sniffBuffer);
              try {
                const detected = await fileTypeFromBuffer(fullBuffer).catch(() => undefined);
                if (!detected) {
                  callback(createHttpError(400, 'Invalid media file signature'));
                  return;
                }
                if (doesKindConflictWithDetectedType(kind, detected.mime)) {
                  callback(createHttpError(400, 'Media MIME type does not match file content'));
                  return;
                }
              } catch (err) {
                callback(err as any);
                return;
              }
            }
            callback();
          }
        });

        limitChecker.on('error', (err) => {
          cleanupAndError(err);
        });

        outStream.on('finish', () => {
          if (!isAborted) {
            cb(null, {
              destination: this.destination,
              filename,
              path: finalPath,
              size: bytesWritten
            });
          }
        });

        file.stream.pipe(limitChecker).pipe(outStream);
      })
      .catch((err) => {
        cb(err);
      });
  }

  _removeFile(
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null) => void
  ) {
    if (file.path) {
      fs.unlink(file.path, cb);
    } else {
      cb(null);
    }
  }
}

export const preCheckContentLength = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const contentLengthHeader = req.headers['content-length'];
  if (!contentLengthHeader) {
    return next();
  }

  const contentLength = parseInt(contentLengthHeader, 10);
  if (isNaN(contentLength)) {
    return next();
  }

  try {
    const limits = await getMediaLimits();
    const maxGb = Math.max(limits.voice, limits.audio, limits.photo, limits.video);
    const maxBytes = gbToBytes(maxGb);
    const allowedMax = maxBytes + 1024 * 1024; // 1MB margin

    if (contentLength > allowedMax) {
      return next(createHttpError(413, 'File is too large'));
    }
    next();
  } catch (error) {
    next(error);
  }
};

const storage = new LimitedDiskStorage(MEDIA_ROOT_DIR);

export const mediaUpload = multer({
  storage,
  limits: {
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.toLowerCase().startsWith('image/svg+xml')) {
      const error = new Error('SVG images are not supported for security reasons') as Error & {
        status?: number;
      };
      error.status = 400;
      cb(error);
      return;
    }
    if (!isAllowedMediaMime(file.mimetype)) {
      const error = new Error('Unsupported media type. Allowed: image, video, audio') as Error & {
        status?: number;
      };
      error.status = 400;
      cb(error);
      return;
    }
    cb(null, true);
  }
});
