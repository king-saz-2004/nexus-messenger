import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { linkPreviewRateLimiter } from '../middleware/rateLimits.js';
import { buildLinkPreview } from '../services/linkPreview/metadata.js';
import { getCachedPreviewImageById } from '../services/linkPreview/imageCache.js';
import { getCache } from '../cache/index.js';
import { cacheKeys } from '../cache/cacheKeys.js';

const router = Router();

// GET /link-preview
router.get(
  '/link-preview',
  requireAuth,
  linkPreviewRateLimiter,
  asyncHandler(async (req, res) => {
    if (!env.linkPreviewEnabled) {
      return res.json({ preview: null, disabled: true });
    }

    const parsed = z
      .object({
        url: z.string().trim().max(2048)
      })
      .safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid url' });
    }

    const rawUrl = parsed.data.url;
    
    // Strict URL check
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ message: 'Only http and https protocols are supported' });
      }
      if (parsedUrl.username || parsedUrl.password) {
        return res.status(400).json({ message: 'URL credentials are not allowed' });
      }
    } catch {
      return res.status(400).json({ message: 'Invalid url' });
    }

    const normalizedUrl = parsedUrl.toString();

    const metadataKey = cacheKeys.linkPreviewMetadata(normalizedUrl);
    const negativeKey = cacheKeys.linkPreviewNegative(normalizedUrl);

    const cache = getCache();
    res.setHeader('Cache-Control', 'private, no-store');

    // Check negative cache first
    const negativeHit = await cache.get(negativeKey);
    if (negativeHit.hit) {
      res.setHeader('X-Cache', 'NEGATIVE');
      return res.json({ preview: null });
    }

    // Attempt to retrieve from standard metadata cache or build it.
    // Cache complete previews longer, but retry no-image previews soon because
    // image fetches are the most likely part to fail transiently.
    const cachedPreview = await cache.get<Awaited<ReturnType<typeof buildLinkPreview>>>(metadataKey);
    let preview = cachedPreview.hit ? cachedPreview.value : undefined;
    res.setHeader('X-Cache', cachedPreview.hit ? 'HIT' : 'MISS');

    if (preview === undefined) {
      preview = await buildLinkPreview(normalizedUrl);
      if (preview !== null) {
        const ttlSeconds = preview.image
          ? env.linkPreviewMetadataCacheTtlSeconds
          : Math.min(60, env.linkPreviewMetadataCacheTtlSeconds);
        await cache.set(metadataKey, preview, ttlSeconds);
      }
    }

    // If metadata build failed, place in negative cache
    if (preview === null) {
      await cache.set(negativeKey, true, env.linkPreviewNegativeCacheTtlSeconds);
    }

    return res.json({ preview });
  })
);

// GET /link-preview/image/:id
router.get(
  '/link-preview/image/:id',
  requireAuth,
  linkPreviewRateLimiter,
  asyncHandler(async (req, res) => {
    if (!env.linkPreviewEnabled) {
      return res.status(404).json({ message: 'Not found' });
    }

    const { id } = req.params;
    if (!/^[a-f0-9]{64}$/.test(id)) {
      return res.status(400).json({ message: 'Invalid image ID' });
    }

    const cachedImg = await getCachedPreviewImageById(id);
    if (!cachedImg) {
      return res.status(404).json({ message: 'Image not found' });
    }

    res.setHeader('Content-Type', cachedImg.contentType);
    res.setHeader('Content-Length', cachedImg.sizeBytes);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return res.sendFile(cachedImg.absolutePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ message: 'Image not found' });
      }
    });
  })
);

export default router;
