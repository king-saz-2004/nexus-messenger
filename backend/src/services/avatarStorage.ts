import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { Express } from 'express';
import { fileTypeFromFile } from 'file-type';

export const AVATAR_ROOT_DIR = path.join(process.cwd(), 'storage', 'avatars');
export const AVATAR_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_URL_PREFIX = '/avatars/';
const ALLOWED_AVATAR_SIGNATURES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const hasSafeStorageKey = (storageKey: string) => /^[A-Za-z0-9._-]+$/.test(storageKey);

const createHttpError = (status: number, message: string) => {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
};

export const ensureAvatarRootExists = () => {
  fs.mkdirSync(AVATAR_ROOT_DIR, { recursive: true });
};

export const isAllowedAvatarMime = (mime: string) => mime.startsWith('image/');

export const validateAvatarFile = (file: Express.Multer.File) => {
  if (!isAllowedAvatarMime(file.mimetype)) {
    throw createHttpError(400, 'Unsupported avatar type. Allowed: image');
  }

  if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
    throw createHttpError(413, 'Avatar is too large. Maximum size is 5MB');
  }
};

export const validateAvatarFileSignature = async (file: Express.Multer.File) => {
  const detected = await fileTypeFromFile(file.path).catch(() => undefined);
  if (!detected || !ALLOWED_AVATAR_SIGNATURES.has(detected.mime)) {
    throw createHttpError(400, 'Invalid avatar file signature');
  }

  if (detected.mime !== file.mimetype) {
    throw createHttpError(400, 'Avatar MIME type does not match file content');
  }
};

export const buildAvatarUrl = (storageKey: string) => `${AVATAR_URL_PREFIX}${storageKey}`;

export const deleteAvatarByStorageKey = async (storageKey: string | null | undefined) => {
  if (!storageKey) return;
  await deleteAvatarByUrl(buildAvatarUrl(storageKey));
};

const extractAvatarStorageKey = (avatarUrl?: string | null) => {
  if (!avatarUrl || !avatarUrl.startsWith(AVATAR_URL_PREFIX)) {
    return null;
  }
  const storageKey = avatarUrl.slice(AVATAR_URL_PREFIX.length).trim();
  if (!storageKey || !hasSafeStorageKey(storageKey)) {
    return null;
  }
  return storageKey;
};

const resolveAvatarPathFromStorageKey = (storageKey: string) => {
  if (!hasSafeStorageKey(storageKey)) {
    return null;
  }

  const normalizedRoot = path.resolve(AVATAR_ROOT_DIR);
  const absolutePath = path.resolve(normalizedRoot, storageKey);
  if (!absolutePath.startsWith(normalizedRoot + path.sep)) {
    return null;
  }
  return absolutePath;
};

export const deleteAvatarByUrl = async (avatarUrl?: string | null) => {
  const storageKey = extractAvatarStorageKey(avatarUrl);
  if (!storageKey) {
    return;
  }

  const absolutePath = resolveAvatarPathFromStorageKey(storageKey);
  if (!absolutePath) {
    return;
  }

  try {
    await fsp.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
};
