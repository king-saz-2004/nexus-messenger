import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { Express } from 'express';
import { fileTypeFromFile } from 'file-type';
import { db } from '../config/db.js';

import type { MediaLimits } from './appSettings.js';

export type SupportedMediaMessageType = 'image' | 'video' | 'audio';

export const MEDIA_ROOT_DIR = path.join(process.cwd(), 'storage', 'media');

export const gbToBytes = (gb: number): number => Math.round(gb * 1000) * 1024 * 1024;

export class MediaFileTooLargeError extends Error {
  status = 413;
  constructor(
    public mediaType: string,
    public maxBytes: number,
    public maxMb: number
  ) {
    super(`File is too large. Maximum size for ${mediaType} is ${maxMb}MB`);
    this.name = 'MediaFileTooLargeError';
    Object.setPrototypeOf(this, MediaFileTooLargeError.prototype);
  }
}

import { createHttpError } from '../utils/errors.js';

export const getLimitKeyForUpload = (mime: string, kind: string): keyof MediaLimits => {
  if (kind === 'voice') {
    return 'voice';
  }
  if (kind === 'audio') {
    return 'audio';
  }
  if (kind === 'photo') {
    return 'photo';
  }
  if (kind === 'video') {
    return 'video';
  }
  throw createHttpError(400, `Invalid media kind: ${kind}`);
};

export const ensureMediaRootExists = () => {
  fs.mkdirSync(MEDIA_ROOT_DIR, { recursive: true });
};

export const normalizeMimeType = (mime: string) => mime.trim().toLowerCase().split(';')[0]?.trim() || '';

export const getMediaTypeFromMime = (mime: string): SupportedMediaMessageType | null => {
  const normalized = normalizeMimeType(mime);
  if (normalized === 'image/svg+xml') return null;
  if (normalized.startsWith('image/')) {
    return 'image';
  }
  if (normalized.startsWith('video/')) {
    return 'video';
  }
  if (normalized.startsWith('audio/')) {
    return 'audio';
  }
  return null;
};

export const isAllowedMediaMime = (mime: string) => getMediaTypeFromMime(mime) !== null;

export const sanitizeOriginalFileName = (name: string) => {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!base) {
    return 'file';
  }
  return base.slice(0, 180);
};

export const doesKindConflictWithDetectedType = (
  kind: 'voice' | 'audio' | 'photo' | 'video',
  detectedMime: string
): boolean => {
  const detectedType = getMediaTypeFromMime(detectedMime);
  if (!detectedType) return true;

  if (kind === 'photo') {
    return detectedType !== 'image';
  }
  if (kind === 'video') {
    return detectedType !== 'video';
  }
  if (kind === 'audio' || kind === 'voice') {
    if (detectedType === 'audio') return false;
    if (detectedType === 'video') {
      const normalized = detectedMime.trim().toLowerCase();
      if (normalized === 'video/mp4' || normalized === 'video/webm') {
        return false;
      }
    }
    return true;
  }
  return true;
};

export const validateMediaFile = (file: Express.Multer.File, limits: MediaLimits, kind: 'voice' | 'audio' | 'photo' | 'video') => {
  const mediaType = getMediaTypeFromMime(file.mimetype);
  if (!mediaType) {
    throw createHttpError(400, 'Unsupported media type. Allowed: image, video, audio');
  }

  const limitKey = getLimitKeyForUpload(file.mimetype, kind);
  const gbLimit = limits[limitKey];
  const maxBytes = gbToBytes(gbLimit);

  if (file.size > maxBytes) {
    const maxMb = Math.round(gbLimit * 1000);
    throw new MediaFileTooLargeError(limitKey, maxBytes, maxMb);
  }

  return {
    mediaType,
    maxBytes
  };
};

type SignatureValidationOptions = {
  expectedMediaType?: SupportedMediaMessageType;
};

const getMimeSubtype = (mime: string) => {
  const normalized = normalizeMimeType(mime);
  const separator = normalized.indexOf('/');
  if (separator === -1 || separator === normalized.length - 1) return '';
  return normalized.slice(separator + 1);
};

const isKnownAudioRecorderContainerMismatch = (
  declaredMimeType: string,
  detectedMimeType: string,
  expectedMediaType?: SupportedMediaMessageType
) => {
  if (expectedMediaType && expectedMediaType !== 'audio') return false;
  if (!declaredMimeType.startsWith('audio/') || !detectedMimeType.startsWith('video/')) {
    return false;
  }

  const declaredSubtype = getMimeSubtype(declaredMimeType);
  const detectedSubtype = getMimeSubtype(detectedMimeType);

  if (
    (declaredSubtype === 'x-m4a' || declaredSubtype === 'm4a' || declaredSubtype === 'mp4') &&
    (detectedSubtype === 'mp4' || detectedSubtype === 'x-m4a' || detectedSubtype === 'm4a')
  ) {
    return true;
  }

  if (!declaredSubtype || declaredSubtype !== detectedSubtype) {
    return false;
  }

  return declaredSubtype === 'webm' || declaredSubtype === 'mp4';
};

export const validateMediaFileSignature = async (file: Express.Multer.File, options: SignatureValidationOptions = {}) => {
  const declaredMimeType = normalizeMimeType(file.mimetype);
  const declaredMediaType = getMediaTypeFromMime(declaredMimeType);
  if (!declaredMediaType) {
    throw createHttpError(400, 'Unsupported media type. Allowed: image, video, audio');
  }

  const detected = await fileTypeFromFile(file.path).catch(() => undefined);
  if (!detected) {
    throw createHttpError(400, 'Invalid media file signature');
  }

  const detectedMimeType = normalizeMimeType(detected.mime);
  const detectedMediaType = getMediaTypeFromMime(detectedMimeType);
  if (!detectedMediaType) {
    throw createHttpError(400, 'Unsupported media signature');
  }

  let canonicalMimeType = detectedMimeType;
  if (declaredMimeType !== detectedMimeType) {
    const declaredCategory = declaredMimeType.split('/')[0];
    const detectedCategory = detectedMimeType.split('/')[0];
    const sameCategory = declaredCategory && detectedCategory && declaredCategory === detectedCategory;

    const knownAudioRecorderMismatch = isKnownAudioRecorderContainerMismatch(
      declaredMimeType,
      detectedMimeType,
      options.expectedMediaType
    );

    if (!sameCategory && !knownAudioRecorderMismatch) {
      throw createHttpError(400, 'Media MIME type does not match file content');
    }

    canonicalMimeType = declaredMimeType;
  }

  const canonicalMediaType = getMediaTypeFromMime(canonicalMimeType);
  if (!canonicalMediaType) {
    throw createHttpError(400, 'Unsupported media signature');
  }

  if (options.expectedMediaType && canonicalMediaType !== options.expectedMediaType) {
    throw createHttpError(400, `Expected ${options.expectedMediaType} media type`);
  }

  return {
    mediaType: canonicalMediaType,
    mimeType: canonicalMimeType
  };
};

export const buildMediaUrl = (messageId: string) => `/media/${messageId}`;

const hasSafeStorageKey = (storageKey: string) => /^[A-Za-z0-9._-]+$/.test(storageKey);

export const resolveMediaPathFromStorageKey = (storageKey: string) => {
  if (!hasSafeStorageKey(storageKey)) {
    throw createHttpError(400, 'Invalid media key');
  }

  const normalizedRoot = path.resolve(MEDIA_ROOT_DIR);
  const absolutePath = path.resolve(normalizedRoot, storageKey);
  if (!absolutePath.startsWith(normalizedRoot + path.sep)) {
    throw createHttpError(400, 'Invalid media key');
  }

  return absolutePath;
};

export const deleteMediaFileByStorageKey = async (storageKey: string | null | undefined) => {
  if (!storageKey) {
    return;
  }

  try {
    const absolutePath = resolveMediaPathFromStorageKey(storageKey);
    await fsp.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

