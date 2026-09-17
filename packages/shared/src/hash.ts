import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** sha256 of a string or byte buffer, lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** sha256 of a file on disk. Reads in one go — callers cap file size first. */
export async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return sha256Hex(bytes);
}

/** Short digest used for cache keys and log correlation. */
export function shortHash(input: string, length = 10): string {
  return sha256Hex(input).slice(0, Math.max(4, Math.min(64, length)));
}

/** Stable content key for deduplication and cache lookups. */
export function contentKey(...parts: Array<string | number | undefined>): string {
  return shortHash(parts.filter((part) => part !== undefined).join('|'), 16);
}