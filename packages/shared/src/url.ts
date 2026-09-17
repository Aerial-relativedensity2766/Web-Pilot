/**
 * URL helpers. Everything here is deterministic and dependency free so it can be
 * unit tested without a browser.
 */

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'svg',
  'ico',
  'tif',
  'tiff',
]);

export function tryParseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  const url = tryParseUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

/** Drops the fragment (and the credentials) so comparisons are meaningful. */
export function normalizeUrl(value: string): string {
  const url = tryParseUrl(value);
  if (!url) return value.trim();
  url.hash = '';
  url.username = '';
  url.password = '';
  return url.toString();
}

export function resolveHttpUrl(href: string, base: string): string | null {
  const url = tryParseUrl(href, base);
  if (!url) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  return url.toString();
}

export function hostnameOf(value: string): string {
  return tryParseUrl(value)?.hostname.toLowerCase() ?? '';
}

export function originOf(value: string): string {
  const url = tryParseUrl(value);
  return url ? url.origin : '';
}

export function sameSite(a: string, b: string): boolean {
  const hostA = hostnameOf(a);
  const hostB = hostnameOf(b);
  if (!hostA || !hostB) return false;
  return hostA === hostB || hostA.endsWith(`.${hostB}`) || hostB.endsWith(`.${hostA}`);
}

export function extensionFromUrl(value: string): string | null {
  const url = tryParseUrl(value);
  const pathname = url ? url.pathname : value;
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return null;
  const ext = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null;
}

export function fileNameFromUrl(value: string, fallback = 'file'): string {
  const url = tryParseUrl(value);
  const pathname = url ? url.pathname : value;
  const raw = pathname.split('/').filter(Boolean).pop() ?? '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const cleaned = decoded.replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 120) : fallback;
}

export function isLikelyImageUrl(value: string): boolean {
  const ext = extensionFromUrl(value);
  if (ext && IMAGE_EXTENSIONS.has(ext)) return true;
  const { pathname } = tryParseUrl(value) ?? { pathname: '' };
  return /\/(image|images|photo|photos|pic|pics|media|thumb|thumbs)\//i.test(pathname);
}

/** 1x1 beacons and analytics images are never worth downloading. */
export function isTrackingPixelLike(value: string, width?: number, height?: number): boolean {
  // Only trust the dimension signal when both dimensions are actually known —
  // an image whose size has not been decoded yet reports 0×0 and must not be
  // mistaken for a pixel.
  if (
    typeof width === 'number' &&
    typeof height === 'number' &&
    width > 0 &&
    height > 0 &&
    width <= 2 &&
    height <= 2
  ) {
    return true;
  }
  return /(pixel|beacon|tracking|analytics|spacer|blank\.gif)/i.test(value);
}

/**
 * Host allow-list check used by the safety layer before downloading.
 * An empty allow-list means "no restriction"; entries match exactly or as a
 * parent domain (`example.com` allows `cdn.example.com`).
 */
export function isAllowedHost(host: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  const target = host.toLowerCase();
  return allowlist.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) return false;
    return target === normalized || target.endsWith(`.${normalized}`);
  });
}

/** Removes `user:password@` from a URL before it is logged or stored. */
export function stripUrlCredentials(value: string): string {
  const url = tryParseUrl(value);
  if (!url) return value;
  url.username = '';
  url.password = '';
  return url.toString();
}