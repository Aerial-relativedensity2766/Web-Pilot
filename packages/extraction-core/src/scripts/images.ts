import type { ImageScanResult } from '../types';

interface ImageScanInput {
  selector: string | null;
  limit: number;
  minWidth: number;
  minHeight: number;
  includeSmall: boolean;
}

/**
 * Runs inside the page. Collects real image candidates from `<img>`, `<source>`
 * and CSS background images, resolving relative URLs and skipping tiny icons.
 *
 * IMPORTANT: this function is serialized by Playwright — it must not reference
 * anything outside its own body.
 */
export function scanImagesInPage(input: ImageScanInput): ImageScanResult[] {
  const results: ImageScanResult[] = [];
  const seen: Record<string, boolean> = {};

  const absolute = (value: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('data:')) return null;
    try {
      const url = new URL(trimmed, document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.toString();
    } catch {
      return null;
    }
  };

  const bestFromSrcset = (srcset: string | null): string | null => {
    if (!srcset) return null;
    let best: string | null = null;
    let bestScore = -1;
    for (const part of srcset.split(',')) {
      const bits = part.trim().split(/\s+/);
      const candidate = bits[0];
      if (!candidate) continue;
      const descriptor = bits[1] ?? '1x';
      let score = 1;
      if (descriptor.endsWith('w')) score = parseInt(descriptor, 10) || 0;
      else if (descriptor.endsWith('x')) score = (parseFloat(descriptor) || 1) * 1_000;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  };

  const push = (url: string | null, alt: string, width: number, height: number, kind: string) => {
    if (!url || seen[url]) return;
    if (results.length >= input.limit) return;
    const tooSmall = width > 0 && height > 0 && (width < input.minWidth || height < input.minHeight);
    if (tooSmall && !input.includeSmall) return;
    seen[url] = true;
    results.push({ url, alt, width, height, kind });
  };

  const root: ParentNode = input.selector
    ? (document.querySelector(input.selector) ?? document)
    : document;

  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    const rect = img.getBoundingClientRect();
    const width = Math.round(img.naturalWidth || rect.width || 0);
    const height = Math.round(img.naturalHeight || rect.height || 0);
    const fromSrcset = bestFromSrcset(img.getAttribute('srcset'));
    const src =
      absolute(img.getAttribute('src')) ??
      absolute(fromSrcset) ??
      absolute(img.getAttribute('data-src')) ??
      absolute(img.getAttribute('data-original'));
    const alt = (img.getAttribute('alt') ?? '').trim().slice(0, 300);
    const kind =
      width > 0 && height > 0 && (width <= 200 || height <= 200)
        ? 'thumbnail'
        : width >= 400
          ? 'content'
          : 'unknown';
    push(src, alt, width, height, kind);
  }

  const sources = Array.from(root.querySelectorAll('picture source, source[type^="image"]'));
  for (const source of sources) {
    push(null, '', 0, 0, 'content');
    const url = absolute(bestFromSrcset(source.getAttribute('srcset')));
    if (url) push(url, '', 0, 0, 'content');
  }

  const styled = Array.from(root.querySelectorAll<HTMLElement>('[style*="background-image"]'));
  for (const element of styled) {
    const match = /url\((['"]?)(.*?)\1\)/i.exec(element.getAttribute('style') ?? '');
    const url = absolute(match ? match[2] ?? null : null);
    if (!url) continue;
    const rect = element.getBoundingClientRect();
    push(url, '', Math.round(rect.width), Math.round(rect.height), 'background');
  }

  return results;
}

/**
 * Runs inside the page: how many `<img>` elements still have no decoded size.
 * Used to avoid ranking images the browser has not measured yet.
 */
export function countPendingImagesInPage(): number {
  let pending = 0;
  for (const img of Array.from(document.querySelectorAll('img'))) {
    const src = img.getAttribute('src');
    if (!src) continue;
    if (img.naturalWidth === 0 && img.complete === false) pending += 1;
  }
  return pending;
}