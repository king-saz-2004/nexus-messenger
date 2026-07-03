import ipaddr from 'ipaddr.js';
import dns from 'node:dns';
import { URL } from 'node:url';

/**
 * Normalizes a URL, returns a normalized string if valid and safe, or null.
 * Rejects non-http/https protocols, empty hosts, and URL credentials.
 */
export function normalizeHttpUrl(rawUrl: string): string | null {
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Asserts that a URL is a valid, normalized HTTP/HTTPS URL.
 * Returns the URL object if valid, or null.
 */
export function assertSafeHttpUrl(rawUrl: string): URL | null {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return null;
  return new URL(normalized);
}

/**
 * Checks if a given parsed IP address or string is safe.
 * Blocks private, loopback, link-local, multicast, reserved, carrier-grade NAT,
 * documentation, benchmarking, unspecified, and non-public IPv4 & IPv6 ranges.
 */
export function isSafeIpAddress(ipStr: string): boolean {
  try {
    const trimmed = ipStr.trim();
    if (!trimmed) return false;
    
    const parsedIp = ipaddr.parse(trimmed);
    let addr = parsedIp;
    
    // Convert IPv4-mapped IPv6 address to IPv4
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      addr = (addr as ipaddr.IPv6).toIPv4Address();
    }
    
    const range = addr.range();
    
    // Explicit block list for known unsafe ranges
    const unsafeRanges = new Set([
      'unspecified',
      'broadcast',
      'multicast',
      'linklocal',
      'loopback',
      'private',
      'carrierGradeNat',
      'documentation',
      'benchmarking',
      'reserved',
      'uniqueLocal'
    ]);
    
    if (unsafeRanges.has(range)) {
      return false;
    }
    
    // Only allow unicast or standard transition mechanisms that route to public space
    return (
      range === 'unicast' ||
      range === '6to4' ||
      range === 'teredo' ||
      range === 'rfc6052' ||
      range === 'rfc6145'
    );
  } catch {
    return false; // Invalid IP addresses are unsafe
  }
}

/**
 * Performs a DNS lookup on a hostname and asserts all resolved addresses are safe.
 * Rejects localhost, .local, and .localhost domains immediately.
 */
export async function isSafeHostname(hostname: string): Promise<boolean> {
  if (!hostname) return false;
  
  const normalizedHost = hostname.toLowerCase().trim();
  if (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost === '::1' ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.localhost')
  ) {
    return false;
  }
  
  try {
    const lookupResult = await dns.promises.lookup(hostname, { all: true });
    if (lookupResult.length === 0) return false;
    
    // Every resolved IP address must be safe
    for (const entry of lookupResult) {
      if (!isSafeIpAddress(entry.address)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Custom DNS lookup resolver for node:http/https requests.
 * Ensures resolved IP addresses are safe before allowing connections.
 */
export function safeLookup(
  hostname: string,
  options: any,
  callback: (err: Error | null, address: any, family?: number) => void
) {
  let realOptions = options;
  let realCallback = callback;
  
  if (typeof options === 'function') {
    realCallback = options;
    realOptions = {};
  }
  
  dns.lookup(hostname, realOptions, (err, address, family) => {
    if (err) {
      return realCallback(err, address, family);
    }
    
    if (Array.isArray(address)) {
      for (const entry of address) {
        if (!isSafeIpAddress(entry.address)) {
          return realCallback(new Error('Unsafe IP address resolved'), address, family);
        }
      }
    } else if (typeof address === 'string') {
      if (!isSafeIpAddress(address)) {
        return realCallback(new Error('Unsafe IP address resolved'), address, family);
      }
    }
    
    realCallback(null, address, family);
  });
}
