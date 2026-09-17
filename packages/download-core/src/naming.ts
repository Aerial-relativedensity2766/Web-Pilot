import { slugify, safeSegment, extensionFromUrl } from '@webpilot/shared';

/**
 * File naming for downloaded resources.
 *
 * `tree-001.jpg`, `tree-002.jpg`, … keeps provenance readable while never
 * trusting a server supplied filename (see `safeSegment`).
 */

export function sanitizeDownloadFilename(value: string, fallback = 'download'): string {
  const withoutQuery = value.split('?')[0] ?? value;
  const parts = withoutQuery.split(/[\\/]/);
  const last = parts[parts.length - 1] ?? '';
  const cleaned = safeSegment(last, fallback);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function splitExtension(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return { base: filename, ext: '' };
  return {
    base: filename.slice(0, dot),
    ext: filename.slice(dot + 1).toLowerCase(),
  };
}

/** `tree`, 3, `jpg` → `tree-003.jpg` */
export function buildFilename(slug: string, index: number, extension: string): string {
  const base = slugify(slug || 'download', 'download');
  const number = String(Math.max(1, Math.trunc(index))).padStart(3, '0');
  const ext = extension.replace(/^\./, '').toLowerCase();
  return ext ? `${base}-${number}.${ext}` : `${base}-${number}`;
}

/** Adds `-2`, `-3`, … until the name is free in the task folder. */
export function uniqueFilename(filename: string, taken: ReadonlySet<string>): string {
  if (!taken.has(filename)) return filename;
  const { base, ext } = splitExtension(filename);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = ext ? `${base}-${suffix}.${ext}` : `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext ? `.${ext}` : ''}`;
}

/**
 * Best-effort extension for a candidate: the sniffed type wins, then the URL
 * extension, then a mime fallback.
 */
export function resolveExtension(input: {
  sniffedExt?: string | null;
  url: string;
  hintFilename?: string | null;
  fallback?: string;
}): string {
  if (input.sniffedExt) return input.sniffedExt;
  const fromHint = input.hintFilename ? splitExtension(input.hintFilename).ext : '';
  if (fromHint) return fromHint;
  return extensionFromUrl(input.url) ?? input.fallback ?? 'bin';
}