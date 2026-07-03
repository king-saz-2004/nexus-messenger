import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { assertSafeHttpUrl, safeLookup } from './urlSafety.js';
import { fetchBinaryWithGuards } from './httpFetch.js';

export const LINK_PREVIEW_IMAGE_ROUTE_PREFIX = '/link-preview/image';

export type LinkPreviewImageCacheMetadata = {
  id: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  extension: '.jpg' | '.png' | '.webp' | '.gif';
  sizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  sourceHost?: string;
};

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
} as const;

// Concurrency control to prevent stampede of fetching the same image URL
const inFlightRequests = new Map<
  string,
  Promise<{
    id: string;
    publicPath: string;
    contentType: string;
    sizeBytes: number;
  } | null>
>();

/**
 * Ensures the link preview image cache directory exists on startup.
 */
export async function ensureLinkPreviewImageCacheDir(): Promise<void> {
  if (!env.linkPreviewEnabled) return;
  try {
    const dir = env.linkPreviewImageCacheDir;
    await fs.mkdir(dir, { recursive: true });
    logger.info('link_preview_cache_dir_ready', { dir });
  } catch (error) {
    logger.error('link_preview_cache_dir_failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    // Re-throw only if the feature is enabled
    if (env.linkPreviewEnabled && env.linkPreviewImageCacheEnabled) {
      throw error;
    }
  }
}

/**
 * Atomic file writing utility to avoid partial writes.
 * Writes to a unique temp file inside the target directory first, then renames it.
 */
async function writeAtomic(dir: string, filename: string, content: Buffer | string): Promise<void> {
  const tempName = `temp_${filename}_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const tempPath = path.join(dir, tempName);
  const finalPath = path.join(dir, filename);
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

/**
 * Retrieves a cached preview image, or fetches and caches it if missing or expired.
 * Implements stampede prevention.
 */
export async function getOrCreateCachedPreviewImage(
  imageUrl: string,
  referer?: string
): Promise<{
  id: string;
  publicPath: string;
  contentType: string;
  sizeBytes: number;
} | null> {
  if (!env.linkPreviewEnabled || !env.linkPreviewImageCacheEnabled) {
    return null;
  }

  const parsedUrl = assertSafeHttpUrl(imageUrl);
  if (!parsedUrl) return null;

  // Use SHA-256 of the normalized URL as the file ID
  const id = crypto.createHash('sha256').update(parsedUrl.toString()).digest('hex');

  // Prevent stampede
  let promise = inFlightRequests.get(id);
  if (!promise) {
    promise = (async () => {
      try {
        const cacheDir = env.linkPreviewImageCacheDir;
        await fs.mkdir(cacheDir, { recursive: true });

        const metaPath = path.join(cacheDir, `${id}.json`);
        let meta: LinkPreviewImageCacheMetadata | null = null;
        try {
          const content = await fs.readFile(metaPath, 'utf8');
          meta = JSON.parse(content);
        } catch {}

        const now = Date.now();
        if (meta && meta.expiresAt > now) {
          const imgPath = path.join(cacheDir, `${id}${meta.extension}`);
          try {
            await fs.access(imgPath);
            
            // Update last accessed time
            meta.lastAccessedAt = now;
            await writeAtomic(cacheDir, `${id}.json`, JSON.stringify(meta));
            
            return {
              id,
              publicPath: `${LINK_PREVIEW_IMAGE_ROUTE_PREFIX}/${id}`,
              contentType: meta.contentType,
              sizeBytes: meta.sizeBytes
            };
          } catch {
            // Associated image file is missing, fetch again
          }
        }

        // Fetch image bytes
        const fetchResult = await fetchBinaryWithGuards(parsedUrl.toString(), {
          timeoutMs: env.linkPreviewFetchTimeoutMs,
          maxBytes: env.linkPreviewImageCacheMaxFileBytes,
          maxRedirects: env.linkPreviewMaxRedirects,
          referer
        });

        if (!fetchResult) return null;

        // Perform magic bytes content signature check
        const typeInfo = await fileTypeFromBuffer(fetchResult.body);
        if (!typeInfo) {
          logger.debug?.('link_preview_image_signature_missing', { url: parsedUrl.toString() });
          return null;
        }

        const mime = typeInfo.mime;
        if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp' && mime !== 'image/gif') {
          logger.debug?.('link_preview_image_signature_invalid', { url: parsedUrl.toString(), mime });
          return null;
        }

        const extension = MIME_TO_EXT[mime];
        const sizeBytes = fetchResult.body.length;

        // Write files atomically
        const imgFilename = `${id}${extension}`;
        const metaFilename = `${id}.json`;

        await writeAtomic(cacheDir, imgFilename, fetchResult.body);

        const newMeta: LinkPreviewImageCacheMetadata = {
          id,
          contentType: mime,
          extension,
          sizeBytes,
          createdAt: now,
          lastAccessedAt: now,
          expiresAt: now + env.linkPreviewImageCacheTtlSeconds * 1000,
          sourceHost: parsedUrl.hostname
        };

        await writeAtomic(cacheDir, metaFilename, JSON.stringify(newMeta));

        return {
          id,
          publicPath: `${LINK_PREVIEW_IMAGE_ROUTE_PREFIX}/${id}`,
          contentType: mime,
          sizeBytes
        };
      } catch (err) {
        logger.warn('get_or_create_cached_preview_image_failed', {
          error: err instanceof Error ? err.message : String(err)
        });
        return null;
      }
    })();

    inFlightRequests.set(id, promise);
    promise.finally(() => {
      inFlightRequests.delete(id);
    });
  }

  return promise;
}

/**
 * Retrieves a cached image path and metadata by ID.
 * Performs directory traversal checks.
 */
export async function getCachedPreviewImageById(
  id: string
): Promise<{
  absolutePath: string;
  contentType: string;
  sizeBytes: number;
} | null> {
  if (!env.linkPreviewEnabled || !env.linkPreviewImageCacheEnabled) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(id)) {
    return null;
  }

  try {
    const cacheDir = env.linkPreviewImageCacheDir;
    const metaPath = path.join(cacheDir, `${id}.json`);
    
    let meta: LinkPreviewImageCacheMetadata | null = null;
    try {
      const content = await fs.readFile(metaPath, 'utf8');
      meta = JSON.parse(content);
    } catch {
      return null;
    }

    if (!meta || meta.expiresAt <= Date.now()) {
      return null;
    }

    const imgPath = path.resolve(cacheDir, `${id}${meta.extension}`);
    
    // Path traversal validation
    const resolvedCacheDir = path.resolve(cacheDir);
    if (!imgPath.startsWith(resolvedCacheDir)) {
      logger.warn('link_preview_cache_traversal_attempt', { id, path: imgPath });
      return null;
    }

    await fs.access(imgPath);

    // Update lastAccessedAt asynchronously
    meta.lastAccessedAt = Date.now();
    writeAtomic(cacheDir, `${id}.json`, JSON.stringify(meta)).catch(() => {});

    return {
      absolutePath: imgPath,
      contentType: meta.contentType,
      sizeBytes: meta.sizeBytes
    };
  } catch {
    return null;
  }
}

/**
 * Cleans up the image cache: deletes expired files, orphans, and evicts LRU files
 * if total cache size exceeds configured maximum total bytes.
 */
export async function cleanupLinkPreviewImageCache(): Promise<void> {
  try {
    const cacheDir = env.linkPreviewImageCacheDir;
    await fs.mkdir(cacheDir, { recursive: true });
    
    const files = await fs.readdir(cacheDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const imgExtensions = ['.jpg', '.png', '.webp', '.gif'];
    
    const validMetadata: LinkPreviewImageCacheMetadata[] = [];
    const now = Date.now();
    
    // 1. Validate metadata sidecars, evict expired or corrupted ones
    for (const jsonFile of jsonFiles) {
      const id = jsonFile.replace(/\.json$/, '');
      const metaPath = path.join(cacheDir, jsonFile);
      
      let meta: LinkPreviewImageCacheMetadata | null = null;
      try {
        const content = await fs.readFile(metaPath, 'utf8');
        meta = JSON.parse(content) as LinkPreviewImageCacheMetadata;
      } catch {
        // Corrupted metadata, delete it
        try { await fs.unlink(metaPath); } catch {}
        for (const ext of imgExtensions) {
          try { await fs.unlink(path.join(cacheDir, `${id}${ext}`)); } catch {}
        }
        continue;
      }
      
      if (!meta || meta.expiresAt <= now) {
        // Expired metadata
        try { await fs.unlink(metaPath); } catch {}
        try { await fs.unlink(path.join(cacheDir, `${id}${meta.extension}`)); } catch {}
        continue;
      }
      
      // Confirm the corresponding image file exists
      const imgPath = path.join(cacheDir, `${id}${meta.extension}`);
      try {
        const stat = await fs.stat(imgPath);
        meta.sizeBytes = stat.size;
        validMetadata.push(meta);
      } catch {
        // Image missing, delete sidecar
        try { await fs.unlink(metaPath); } catch {}
      }
    }
    
    // 2. Scan and remove orphan image files
    const validImageFiles = new Set(validMetadata.map(m => `${m.id}${m.extension}`));
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (imgExtensions.includes(ext)) {
        if (!validImageFiles.has(file)) {
          try { await fs.unlink(path.join(cacheDir, file)); } catch {}
        }
      }
    }
    
    // 3. LRU Cache size eviction
    let totalSize = validMetadata.reduce((sum, m) => sum + m.sizeBytes, 0);
    const maxSize = env.linkPreviewImageCacheMaxTotalBytes;
    
    if (totalSize > maxSize) {
      // Sort oldest accessed first
      validMetadata.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
      
      for (const meta of validMetadata) {
        if (totalSize <= maxSize) break;
        
        const metaPath = path.join(cacheDir, `${meta.id}.json`);
        const imgPath = path.join(cacheDir, `${meta.id}${meta.extension}`);
        
        try {
          await fs.unlink(metaPath);
          await fs.unlink(imgPath);
          totalSize -= meta.sizeBytes;
        } catch {}
      }
    }
    
    logger.debug?.('link_preview_cache_cleanup_finished', {
      totalSize,
      maxSize,
      fileCount: validMetadata.length
    });
  } catch (error) {
    logger.warn('link_preview_cache_cleanup_failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Starts periodic cleanup scheduling.
 */
export function startLinkPreviewImageCacheCleanup(): NodeJS.Timeout | null {
  if (!env.linkPreviewEnabled || !env.linkPreviewImageCacheEnabled) {
    return null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  cleanupInterval = setInterval(() => {
    cleanupLinkPreviewImageCache().catch(err => {
      logger.warn('link_preview_cache_cleanup_failed', {
        error: err instanceof Error ? err.message : String(err)
      });
    });
  }, env.linkPreviewImageCacheCleanupIntervalSeconds * 1000);
  
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }
  
  return cleanupInterval;
}
