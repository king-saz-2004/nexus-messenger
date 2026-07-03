import { parse as parseHtml } from 'node-html-parser';
import { fetchHtmlWithGuards, fetchJsonWithGuards } from './httpFetch.js';
import { getOrCreateCachedPreviewImage } from './imageCache.js';
import { assertSafeHttpUrl } from './urlSafety.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const resolveMeta = (root: ReturnType<typeof parseHtml>, property: string) => {
  return resolveMetaValues(root, property)[0] ?? null;
};

const resolveMetaValues = (root: ReturnType<typeof parseHtml>, property: string) => {
  const normalizedProperty = property.toLowerCase();
  const values: string[] = [];
  const nodes = root.querySelectorAll('meta');
  for (const node of nodes) {
    const propertyAttr = node.getAttribute('property')?.trim().toLowerCase();
    const nameAttr = node.getAttribute('name')?.trim().toLowerCase();
    const itemPropAttr = node.getAttribute('itemprop')?.trim().toLowerCase();
    if (propertyAttr === normalizedProperty || nameAttr === normalizedProperty || itemPropAttr === normalizedProperty) {
      const content = node.getAttribute('content')?.trim();
      if (content) values.push(content);
    }
  }
  return values;
};

const resolveFirstMeta = (root: ReturnType<typeof parseHtml>, properties: string[]) => {
  for (const property of properties) {
    const value = resolveMeta(root, property);
    if (value) return value;
  }
  return null;
};

const uniqueStrings = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

const decodeHtmlAttribute = (value: string) =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

const splitClassLikeValue = (value: string | null | undefined) =>
  (value ?? '')
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);

const getMeaningfulTitleKeywords = (root: ReturnType<typeof parseHtml>) => {
  const title = [
    resolveFirstMeta(root, ['og:title', 'twitter:title', 'title']),
    root.querySelector('title')?.text.trim() || null,
    root.querySelector('h1')?.text.trim() || null
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const ignored = new Set([
    'and',
    'are',
    'for',
    'from',
    'have',
    'http',
    'https',
    'shop',
    'the',
    'this',
    'with',
    'www'
  ]);

  return uniqueStrings(
    title
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .split(/[\s-]+/)
      .map(part => part.trim())
      .filter(part => part.length >= 4 && !ignored.has(part))
  ).slice(0, 12);
};

const isUnsafeImageCandidate = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('javascript:') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:')
  );
};

const parseDimensionAttr = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const parseSrcsetCandidates = (srcset: string | null | undefined) => {
  if (!srcset) return [];

  const parsed = srcset
    .split(',')
    .map(candidate => candidate.trim())
    .filter(Boolean)
    .map(candidate => {
      const parts = candidate.split(/\s+/).filter(Boolean);
      const url = parts[0]?.trim();
      if (!url || isUnsafeImageCandidate(url)) return null;

      let width = 0;
      let density = 0;
      for (const descriptor of parts.slice(1)) {
        const widthMatch = descriptor.match(/^(\d+)w$/i);
        if (widthMatch) {
          width = Number.parseInt(widthMatch[1], 10) || 0;
          continue;
        }

        const densityMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
        if (densityMatch) {
          density = Number.parseFloat(densityMatch[1]) || 0;
        }
      }

      return { url, width, density };
    })
    .filter((candidate): candidate is { url: string; width: number; density: number } => Boolean(candidate));

  const withWidths = parsed.filter(candidate => candidate.width > 0);
  const sorted = (withWidths.length > 0 ? withWidths : parsed).sort((a, b) => {
    if (withWidths.length > 0) return b.width - a.width;
    return b.density - a.density;
  });

  return uniqueStrings(sorted.map(candidate => candidate.url));
};

const resolveImageMetaCandidates = (root: ReturnType<typeof parseHtml>) =>
  uniqueStrings(
    [
      'og:image:secure_url',
      'og:image:url',
      'og:image',
      'twitter:image:src',
      'twitter:image',
      'thumbnail',
      'thumbnailurl',
      'image'
    ].flatMap(property => resolveMetaValues(root, property))
  );

const resolveImageSrcLinks = (root: ReturnType<typeof parseHtml>) => {
  const values: string[] = [];
  const links = root.querySelectorAll('link');
  for (const link of links) {
    const rels = (link.getAttribute('rel') || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (rels.includes('image_src') || rels.includes('preload')) {
      const asAttr = link.getAttribute('as')?.trim().toLowerCase();
      if (rels.includes('preload') && asAttr !== 'image') continue;
      const href = link.getAttribute('href')?.trim();
      if (href) values.push(href);
    }
  }
  return uniqueStrings(values);
};

export const resolveHtmlImageCandidates = (root: ReturnType<typeof parseHtml>) => {
  type Candidate = {
    value: string;
    score: number;
    order: number;
  };

  const candidates: Candidate[] = [];
  const pageKeywords = getMeaningfulTitleKeywords(root);
  const positiveHints = [
    'product',
    'main',
    'gallery',
    'featured',
    'image',
    'photo',
    'wp-post-image',
    'woocommerce',
    'attachment',
    'single',
    'large',
    'hero'
  ];
  const negativeHints = [
    'logo',
    'icon',
    'avatar',
    'badge',
    'sprite',
    'placeholder',
    'loading',
    'spinner',
    'transparent',
    'payment',
    'banner',
    'ads',
    'advert',
    'emoji',
    'svg'
  ];

  const addCandidate = (
    rawValue: string | null | undefined,
    attrs: {
      alt?: string | null;
      title?: string | null;
      className?: string | null;
      id?: string | null;
      width?: string | null;
      height?: string | null;
      srcsetRank?: number;
      fromPictureSource?: boolean;
    },
    order: number
  ) => {
    const value = decodeHtmlAttribute(rawValue?.trim() ?? '');
    if (!value || isUnsafeImageCandidate(value)) return;

    const urlLower = value.toLowerCase();
    const attrText = [
      attrs.alt,
      attrs.title,
      attrs.className,
      attrs.id,
      urlLower
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const attrTokens = splitClassLikeValue(attrText);
    const width = parseDimensionAttr(attrs.width);
    const height = parseDimensionAttr(attrs.height);
    let score = 100 - Math.min(order, 80);

    for (const hint of positiveHints) {
      if (attrText.includes(hint) || attrTokens.includes(hint)) score += 24;
    }

    for (const hint of negativeHints) {
      if (attrText.includes(hint) || attrTokens.includes(hint)) score -= 70;
    }

    for (const keyword of pageKeywords) {
      const visibleText = `${attrs.alt ?? ''} ${attrs.title ?? ''}`.toLowerCase();
      if (visibleText.includes(keyword) || urlLower.includes(keyword)) score += 14;
    }

    if ((width && width >= 120) || (height && height >= 120)) score += 24;
    if ((width && width < 80) || (height && height < 80)) score -= 80;
    if (/\/(?:wp-content\/uploads|uploads|media|image|images|product|products|gallery|cache)\//i.test(value)) score += 28;
    if (/\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(value)) score += 14;
    if (/\.svg(?:[?#].*)?$/i.test(value)) score -= 90;
    if (attrs.srcsetRank !== undefined) score += Math.max(0, 16 - attrs.srcsetRank * 4);
    if (attrs.fromPictureSource) score += 8;

    candidates.push({ value, score, order });
  };

  const imageNodes = root.querySelectorAll('img');
  imageNodes.forEach((img, index) => {
    const attrs = {
      alt: img.getAttribute('alt'),
      title: img.getAttribute('title'),
      className: img.getAttribute('class'),
      id: img.getAttribute('id'),
      width: img.getAttribute('width') || img.getAttribute('data-width'),
      height: img.getAttribute('height') || img.getAttribute('data-height')
    };
    const directAttrs = [
      'src',
      'data-src',
      'data-lazy-src',
      'data-original',
      'data-large_image',
      'data-thumb',
      'data-full',
      'data-full-src',
      'data-image',
      'data-image-src',
      'data-zoom-image',
      'data-large',
      'data-o_src',
      'data-src-retina',
      'data-lazy',
      'data-bg'
    ];

    directAttrs.forEach((attrName, attrIndex) => {
      addCandidate(img.getAttribute(attrName), attrs, index * 10 + attrIndex);
    });

    parseSrcsetCandidates(img.getAttribute('srcset') || img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset'))
      .forEach((srcsetValue, srcsetIndex) => {
        addCandidate(srcsetValue, { ...attrs, srcsetRank: srcsetIndex }, index * 10 + directAttrs.length + srcsetIndex);
      });
  });

  const pictureSources = root.querySelectorAll('picture source');
  pictureSources.forEach((source, index) => {
    parseSrcsetCandidates(source.getAttribute('srcset') || source.getAttribute('data-srcset') || source.getAttribute('data-lazy-srcset'))
      .forEach((srcsetValue, srcsetIndex) => {
        addCandidate(
          srcsetValue,
          {
            className: source.getAttribute('class'),
            id: source.getAttribute('id'),
            width: source.getAttribute('width'),
            height: source.getAttribute('height'),
            srcsetRank: srcsetIndex,
            fromPictureSource: true
          },
          imageNodes.length * 10 + index * 10 + srcsetIndex
        );
      });
  });

  return uniqueStrings(
    candidates
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map(candidate => candidate.value)
  );
};

const resolveJsonLdImages = (root: ReturnType<typeof parseHtml>) => {
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  const values: string[] = [];

  const collectImageValue = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      values.push(value.trim());
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) {
        collectImageValue(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const directUrl = record.url || record.contentUrl;
    if (typeof directUrl === 'string' && directUrl.trim()) {
      values.push(directUrl.trim());
    }
  };

  const walkStructuredData = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) {
        walkStructuredData(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const image = record.image || record.thumbnailUrl || record.thumbnail;
    collectImageValue(image);

    if (record['@graph']) walkStructuredData(record['@graph']);
  };

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.text.trim());
      walkStructuredData(parsed);
    } catch {
      // Ignore malformed structured data.
    }
  }
  return uniqueStrings(values);
};

function collapseWhitespace(str: string | null): string | null {
  if (!str) return null;
  return str.replace(/\s+/g, ' ').trim();
}

function truncateString(str: string | null, maxLength: number): string | null {
  const collapsed = collapseWhitespace(str);
  if (!collapsed) return null;
  if (collapsed.length <= maxLength) return collapsed;
  return collapsed.slice(0, maxLength - 3) + '...';
}

/**
 * Builds a link preview metadata object by fetching and parsing the HTML content of the page.
 * Downloads and caches the preview image through the imageCache service.
 */
export async function buildLinkPreview(rawUrl: string): Promise<LinkPreviewData | null> {
  const parsedUrl = assertSafeHttpUrl(rawUrl);
  if (!parsedUrl) return null;

  try {
    // 1. YouTube oEmbed optimization
    if (/(?:youtube\.com|youtu\.be)/i.test(parsedUrl.hostname)) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`;
      const oembedFetch = await fetchJsonWithGuards(oembedUrl, {
        timeoutMs: env.linkPreviewFetchTimeoutMs,
        maxBytes: env.linkPreviewHtmlMaxBytes,
        maxRedirects: env.linkPreviewMaxRedirects
      });
      if (oembedFetch && oembedFetch.status >= 200 && oembedFetch.status < 300) {
        try {
          const oembedData = JSON.parse(oembedFetch.body.toString('utf8'));
          if (oembedData && (oembedData.title || oembedData.thumbnail_url)) {
            let cachedImagePublicPath: string | null = null;
            const ogImage = oembedData.thumbnail_url;
            if (ogImage && env.linkPreviewImageCacheEnabled) {
              try {
                const resolvedImgUrl = new URL(ogImage.trim(), oembedFetch.finalUrl);
                if (['http:', 'https:'].includes(resolvedImgUrl.protocol) && !resolvedImgUrl.username && !resolvedImgUrl.password) {
                  const cachedImg = await getOrCreateCachedPreviewImage(resolvedImgUrl.toString(), parsedUrl.toString());
                  if (cachedImg) {
                    cachedImagePublicPath = cachedImg.publicPath;
                  }
                }
              } catch (err) {
                // Non-fatal image caching failure
              }
            }
            return {
              url: truncateString(rawUrl, 2048)!,
              title: truncateString(oembedData.title, 180),
              description: truncateString(oembedData.author_name ? `By ${oembedData.author_name}` : null, 300),
              image: cachedImagePublicPath,
              siteName: "YouTube"
            };
          }
        } catch {
          // Parse failed, fallback to normal parser
        }
      }
    }

    // 2. Aparat video page player iframe rewrite
    let fetchUrl = parsedUrl.toString();
    const aparatMatch = rawUrl.match(/(?:aparat\.com\/v\/)([a-zA-Z0-9_-]+)/i);
    let isAparatEmbed = false;
    if (aparatMatch) {
      fetchUrl = `https://www.aparat.com/video/video/embed/videohash/${aparatMatch[1]}/vt/frame`;
      isAparatEmbed = true;
    }

    const fetchResult = await fetchHtmlWithGuards(fetchUrl, {
      timeoutMs: env.linkPreviewFetchTimeoutMs,
      maxBytes: env.linkPreviewHtmlMaxBytes,
      maxRedirects: env.linkPreviewMaxRedirects,
      allowTruncated: true
    });

    if (!fetchResult || fetchResult.status < 200 || fetchResult.status >= 300) {
      return null;
    }

    const html = fetchResult.body.toString('utf8');
    const root = parseHtml(html);

    // Resolve titles
    const ogTitle = resolveFirstMeta(root, ['og:title', 'twitter:title', 'title']);
    const titleTag = root.querySelector('title')?.text.trim() || null;

    // Resolve descriptions
    const ogDescription = resolveFirstMeta(root, ['og:description', 'twitter:description', 'description']);

    // Resolve site name
    const ogSiteName = resolveFirstMeta(root, ['og:site_name', 'twitter:site', 'site_name', 'application-name']);

    // Resolve images
    const metaImageCandidates = resolveImageMetaCandidates(root);
    const linkImageCandidates = resolveImageSrcLinks(root);
    const jsonLdImageCandidates = resolveJsonLdImages(root);
    const htmlImageCandidates = resolveHtmlImageCandidates(root);
    const providerImageCandidates: string[] = [];

    // 3. Fallback extraction for Aparat script-embedded poster image
    if (isAparatEmbed) {
      const posterMatch = html.match(/"poster"\s*:\s*"([^"]+)"/) || html.match(/"smallPoster"\s*:\s*"([^"]+)"/);
      if (posterMatch) {
        // Remove JSON escaping
        providerImageCandidates.push(posterMatch[1].replace(/\\/g, ''));
      }
    }

    const imageCandidates = uniqueStrings([
      ...metaImageCandidates,
      ...linkImageCandidates,
      ...jsonLdImageCandidates,
      ...htmlImageCandidates,
      ...providerImageCandidates
    ]);

    const title = truncateString(ogTitle || titleTag, 180);
    const description = truncateString(ogDescription, 300);
    const siteName = truncateString(ogSiteName || (isAparatEmbed ? 'Aparat' : parsedUrl.hostname), 80);

    // If there is no meaningful info, return null
    if (!title && !description && imageCandidates.length === 0) {
      return null;
    }

    let cachedImagePublicPath: string | null = null;

    if (env.linkPreviewImageCacheEnabled) {
      const failedImageCandidates: Array<{ host: string | null; reason: string }> = [];

      for (const imageCandidate of uniqueStrings(imageCandidates)) {
        try {
          const resolvedImgUrl = new URL(decodeHtmlAttribute(imageCandidate), fetchResult.finalUrl);
          if (!['http:', 'https:'].includes(resolvedImgUrl.protocol)) {
            failedImageCandidates.push({ host: null, reason: 'unsupported_protocol' });
            continue;
          }
          if (resolvedImgUrl.username || resolvedImgUrl.password) {
            failedImageCandidates.push({ host: resolvedImgUrl.hostname, reason: 'url_credentials' });
            continue;
          }

          const cachedImg = await getOrCreateCachedPreviewImage(resolvedImgUrl.toString(), fetchResult.finalUrl);
          if (cachedImg) {
            cachedImagePublicPath = cachedImg.publicPath;
            break;
          }
          failedImageCandidates.push({ host: resolvedImgUrl.hostname, reason: 'cache_fetch_or_validation_failed' });
        } catch (err) {
          failedImageCandidates.push({
            host: null,
            reason: err instanceof Error ? err.name || 'invalid_candidate_url' : 'invalid_candidate_url'
          });
          // Non-fatal, try the next candidate and keep title/description if all fail.
          logger.debug?.('link_preview_image_fetch_failed_non_fatal', {
            host: parsedUrl.hostname,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      if (!cachedImagePublicPath && imageCandidates.length > 0) {
        logger.debug?.('link_preview_all_image_candidates_failed', {
          host: parsedUrl.hostname,
          metaImageCandidateCount: metaImageCandidates.length,
          htmlImageCandidateCount: htmlImageCandidates.length,
          htmlTruncated: Boolean(fetchResult.truncated),
          failures: failedImageCandidates.slice(0, 10)
        });
      }
    }

    if (!cachedImagePublicPath && imageCandidates.length === 0) {
      logger.debug?.('link_preview_no_image_candidates_found', {
        host: parsedUrl.hostname,
        metaImageCandidateCount: metaImageCandidates.length,
        htmlImageCandidateCount: htmlImageCandidates.length,
        htmlTruncated: Boolean(fetchResult.truncated)
      });
    }

    return {
      url: truncateString(rawUrl, 2048)!,
      title,
      description,
      image: cachedImagePublicPath,
      siteName
    };
  } catch (error) {
    logger.debug?.('build_link_preview_failed', {
      host: parsedUrl.hostname,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
