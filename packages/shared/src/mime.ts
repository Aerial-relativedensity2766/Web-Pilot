/**
 * MIME detection from magic bytes.
 *
 * Servers lie about `Content-Type` and plenty of image URLs have no extension,
 * so the downloader verifies what it actually received instead of trusting
 * either signal.
 */

interface Signature {
  mime: string;
  ext: string;
  matches: (bytes: Uint8Array) => boolean;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.slice(offset, offset + length))
    .map((byte) => String.fromCharCode(byte))
    .join('');
}

const SIGNATURES: readonly Signature[] = [
  { mime: 'image/jpeg', ext: 'jpg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    mime: 'image/png',
    ext: 'png',
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mime: 'image/gif', ext: 'gif', matches: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mime: 'image/webp',
    ext: 'webp',
    matches: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, 4) === 'WEBP',
  },
  { mime: 'image/bmp', ext: 'bmp', matches: (b) => startsWith(b, [0x42, 0x4d]) },
  { mime: 'image/x-icon', ext: 'ico', matches: (b) => startsWith(b, [0x00, 0x00, 0x01, 0x00]) },
  {
    mime: 'image/avif',
    ext: 'avif',
    matches: (b) => ascii(b, 4, 4) === 'ftyp' && ascii(b, 8, 4).startsWith('avif'),
  },
  {
    mime: 'image/heic',
    ext: 'heic',
    matches: (b) => ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|mif1)$/.test(ascii(b, 8, 4)),
  },
  { mime: 'application/pdf', ext: 'pdf', matches: (b) => ascii(b, 0, 4) === '%PDF' },
  { mime: 'application/zip', ext: 'zip', matches: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  { mime: 'application/gzip', ext: 'gz', matches: (b) => startsWith(b, [0x1f, 0x8b]) },
  {
    mime: 'video/mp4',
    ext: 'mp4',
    matches: (b) =>
      ascii(b, 4, 4) === 'ftyp' && /^(isom|mp41|mp42|dash|iso2)$/.test(ascii(b, 8, 4)),
  },
  { mime: 'video/webm', ext: 'webm', matches: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  {
    mime: 'audio/mpeg',
    ext: 'mp3',
    matches: (b) => startsWith(b, [0x49, 0x44, 0x33]) || startsWith(b, [0xff, 0xfb]),
  },
  { mime: 'audio/ogg', ext: 'ogg', matches: (b) => ascii(b, 0, 4) === 'OggS' },
  {
    mime: 'audio/wav',
    ext: 'wav',
    matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE',
  },
];

/** Text based formats are detected from their leading characters. */
function sniffTextFormat(bytes: Uint8Array): { mime: string; ext: string } | null {
  const head = ascii(bytes, 0, Math.min(bytes.length, 64)).trimStart();
  const lower = head.toLowerCase();
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
    return { mime: 'text/html', ext: 'html' };
  }
  if (lower.startsWith('<?xml')) return { mime: 'application/xml', ext: 'xml' };
  if (lower.startsWith('<svg')) return { mime: 'image/svg+xml', ext: 'svg' };
  if (lower.startsWith('{') || lower.startsWith('[')) {
    try {
      JSON.parse(new TextDecoder().decode(bytes.slice(0, 4_096)));
      return { mime: 'application/json', ext: 'json' };
    } catch {
      return { mime: 'text/plain', ext: 'txt' };
    }
  }
  return null;
}

function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 512);
  if (sample.length === 0) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)) {
      printable += 1;
    } else if (byte >= 0xc2 && byte <= 0xf4) {
      printable += 1; // plausible UTF-8 lead byte
    }
  }
  return printable / sample.length > 0.9;
}

export interface SniffedType {
  mime: string;
  ext: string;
}

/** Returns the detected type, or `null` when the bytes are unrecognised. */
export function sniffType(bytes: Uint8Array): SniffedType | null {
  for (const signature of SIGNATURES) {
    if (signature.matches(bytes)) return { mime: signature.mime, ext: signature.ext };
  }
  const text = sniffTextFormat(bytes);
  if (text) return text;
  if (looksLikeUtf8Text(bytes)) return { mime: 'text/plain', ext: 'txt' };
  return null;
}

export function sniffMime(bytes: Uint8Array): string | null {
  return sniffType(bytes)?.mime ?? null;
}

export const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

const MIME_TO_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_TO_MIME).map(([ext, mime]) => [mime, ext]),
);

export function mimeForExtension(ext: string): string | null {
  return EXTENSION_TO_MIME[ext.replace(/^\./, '').toLowerCase()] ?? null;
}

export function extensionForMime(mime: string): string | null {
  return MIME_TO_EXTENSION[normalizeContentType(mime)] ?? null;
}

/** `image/jpeg; charset=binary` → `image/jpeg` */
export function normalizeContentType(value: string | null | undefined): string {
  if (!value) return '';
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * True when the declared content type is compatible with the file extension.
 * Generic types (`application/octet-stream`, `text/plain`) are always accepted
 * because so many servers use them as a fallback.
 */
export function mimeMatchesExtension(mime: string, ext: string): boolean {
  const normalized = normalizeContentType(mime);
  if (!normalized) return true;
  if (normalized === 'application/octet-stream' || normalized === 'binary/octet-stream') {
    return true;
  }
  if (normalized === 'text/plain') return true;
  const expected = mimeForExtension(ext);
  if (!expected) return true;
  if (expected === normalized) return true;
  if (normalized === 'image/jpg' && expected === 'image/jpeg') return true;
  return false;
}

export function isImageMime(mime: string): boolean {
  return normalizeContentType(mime).startsWith('image/');
}

export function isTextMime(mime: string): boolean {
  const normalized = normalizeContentType(mime);
  return normalized.startsWith('text/') || normalized === 'application/json';
}