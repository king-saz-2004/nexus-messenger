import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { assertSafeHttpUrl, isSafeHostname, safeLookup } from './urlSafety.js';
import { logger } from '../../config/logger.js';

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated?: boolean;
};

/**
 * Internal helper to perform a safe HTTP/HTTPS GET request.
 * Enforces timeouts, max redirect limit, DNS safety validation, content-type checks,
 * and maximum payload byte constraints.
 */
async function fetchWithGuardsInternal(
  urlStr: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    acceptedContentTypes?: Set<string>;
    headers?: Record<string, string>;
    allowTruncated?: boolean;
    currentRedirectCount?: number;
  }
): Promise<SafeFetchResult | null> {
  const currentRedirectCount = options.currentRedirectCount ?? 0;
  if (currentRedirectCount > options.maxRedirects) {
    logger.debug?.('fetch_with_guards_max_redirects_exceeded', { url: urlStr, count: currentRedirectCount });
    return null;
  }

  const parsedUrl = assertSafeHttpUrl(urlStr);
  if (!parsedUrl) {
    logger.debug?.('fetch_with_guards_invalid_or_unsafe_url', { url: urlStr });
    return null;
  }

  // Double check host safety before sending request
  const safeHost = await isSafeHostname(parsedUrl.hostname);
  if (!safeHost) {
    logger.debug?.('fetch_with_guards_unsafe_host', { host: parsedUrl.hostname });
    return null;
  }

  return new Promise((resolve) => {
    let req: http.ClientRequest | null = null;
    let completed = false;

    const cleanupAndResolve = (result: SafeFetchResult | null) => {
      if (completed) return;
      completed = true;
      if (req) {
        try {
          req.destroy();
        } catch {}
      }
      resolve(result);
    };

    try {
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      req = lib.request(
        parsedUrl.toString(),
        {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': '*/*',
            ...options.headers
          },
          lookup: safeLookup,
          timeout: options.timeoutMs,
        },
        async (res) => {
          try {
            const status = res.statusCode || 0;
            const headers: Record<string, string> = {};
            for (const [key, val] of Object.entries(res.headers)) {
              if (val !== undefined) {
                headers[key.toLowerCase()] = Array.isArray(val) ? val[0] : val;
              }
            }

            // Handle HTTP Redirects
            if ([301, 302, 303, 307, 308].includes(status)) {
              const location = headers['location'];
              if (!location) {
                return cleanupAndResolve(null);
              }
              
              // Resolve relative redirect location against current URL
              const redirectUrl = new URL(location, parsedUrl).toString();
              
              // Resume response stream to avoid memory leak
              res.resume();
              
              const nextResult = await fetchWithGuardsInternal(redirectUrl, {
                ...options,
                currentRedirectCount: currentRedirectCount + 1
              });
              return cleanupAndResolve(nextResult);
            }

            // Validate Content-Type header if whitelist is provided
            const contentType = (headers['content-type'] ?? '').toLowerCase();
            if (options.acceptedContentTypes) {
              let accepted = false;
              for (const type of options.acceptedContentTypes) {
                if (contentType.includes(type)) {
                  accepted = true;
                  break;
                }
              }
              if (!accepted) {
                res.resume();
                return cleanupAndResolve(null);
              }
            }

            // Content-Length check before streaming
            const contentLengthStr = headers['content-length'];
            if (contentLengthStr) {
              const contentLength = parseInt(contentLengthStr, 10);
              if (!isNaN(contentLength) && contentLength > options.maxBytes && !options.allowTruncated) {
                res.resume();
                return cleanupAndResolve(null);
              }
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;
            let storedBytes = 0;

            res.on('data', (chunk: Buffer) => {
              if (completed) return;
              totalBytes += chunk.length;
              if (storedBytes + chunk.length > options.maxBytes) {
                if (!options.allowTruncated) {
                  res.destroy();
                  cleanupAndResolve(null);
                  return;
                }

                const remainingBytes = options.maxBytes - storedBytes;
                if (remainingBytes > 0) {
                  chunks.push(chunk.subarray(0, remainingBytes));
                  storedBytes += remainingBytes;
                }
                res.destroy();
                cleanupAndResolve({
                  finalUrl: parsedUrl.toString(),
                  status,
                  headers,
                  body: Buffer.concat(chunks, storedBytes),
                  truncated: true
                });
                return;
              }
              chunks.push(chunk);
              storedBytes += chunk.length;
            });

            res.on('end', () => {
              if (completed) return;
              const body = Buffer.concat(chunks, storedBytes);
              cleanupAndResolve({
                finalUrl: parsedUrl.toString(),
                status,
                headers,
                body,
                truncated: totalBytes > storedBytes
              });
            });

            res.on('error', () => {
              cleanupAndResolve(null);
            });
          } catch (e) {
            cleanupAndResolve(null);
          }
        }
      );

      req.on('error', () => {
        cleanupAndResolve(null);
      });

      req.on('timeout', () => {
        if (req) {
          req.destroy();
        }
        cleanupAndResolve(null);
      });

      req.end();
    } catch (e) {
      cleanupAndResolve(null);
    }
  });
}

/**
 * Safe fetcher for HTML content.
 * Accepts only 'text/html' and 'application/xhtml+xml'.
 */
export async function fetchHtmlWithGuards(
  url: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    allowTruncated?: boolean;
  }
): Promise<SafeFetchResult | null> {
  return fetchWithGuardsInternal(url, {
    ...options,
    acceptedContentTypes: new Set(['text/html', 'application/xhtml+xml']),
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
}

/**
 * Safe fetcher for JSON metadata endpoints such as oEmbed.
 */
export async function fetchJsonWithGuards(
  url: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
  }
): Promise<SafeFetchResult | null> {
  return fetchWithGuardsInternal(url, {
    ...options,
    acceptedContentTypes: new Set(['application/json', 'text/json']),
    headers: {
      'Accept': 'application/json,text/json,*/*;q=0.8'
    }
  });
}

/**
 * Safe fetcher for binary media assets (images).
 * Accepts 'image/jpeg', 'image/png', 'image/webp', 'image/gif' by default.
 */
export async function fetchBinaryWithGuards(
  url: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    acceptedContentTypes?: Set<string>;
    referer?: string;
  }
): Promise<SafeFetchResult | null> {
  // Image endpoints and CDNs sometimes reply with generic or missing
  // Content-Type headers. Callers still validate magic bytes before use.
  return fetchWithGuardsInternal(url, {
    ...options,
    acceptedContentTypes: options.acceptedContentTypes,
    headers: {
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      ...(options.referer ? { 'Referer': options.referer } : {})
    }
  });
}
