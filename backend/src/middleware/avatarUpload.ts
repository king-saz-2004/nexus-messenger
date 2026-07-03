import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import multer from 'multer';
import type { Request } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { createHttpError } from '../utils/errors.js';
import {
  AVATAR_ROOT_DIR,
  AVATAR_UPLOAD_MAX_BYTES,
  ensureAvatarRootExists,
  isAllowedAvatarMime
} from '../services/avatarStorage.js';

ensureAvatarRootExists();

const extractSafeExtension = (originalName: string) => {
  const extension = path.extname(originalName).toLowerCase().slice(0, 12);
  return /^\.[a-z0-9]+$/.test(extension) ? extension : '';
};

class AvatarDiskStorage implements multer.StorageEngine {
  constructor(private destination: string) {}

  _handleFile(
    req: Request,
    file: Express.Multer.File,
    cb: (error?: any, info?: Partial<Express.Multer.File>) => void
  ) {
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

    const checker = new Transform({
      async transform(chunk, encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > AVATAR_UPLOAD_MAX_BYTES) {
          callback(createHttpError(400, 'Avatar file is too large'));
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
              if (!detected || !isAllowedAvatarMime(detected.mime)) {
                callback(createHttpError(400, 'Unsupported avatar file content signature'));
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
            if (!detected || !isAllowedAvatarMime(detected.mime)) {
              callback(createHttpError(400, 'Unsupported avatar file content signature'));
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

    checker.on('error', (err) => {
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

    file.stream.pipe(checker).pipe(outStream);
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

export const avatarUpload = multer({
  storage: new AvatarDiskStorage(AVATAR_ROOT_DIR),
  limits: {
    files: 1,
    fileSize: AVATAR_UPLOAD_MAX_BYTES
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedAvatarMime(file.mimetype)) {
      const error = createHttpError(400, 'Unsupported avatar type. Allowed: image');
      cb(error);
      return;
    }
    cb(null, true);
  }
});
