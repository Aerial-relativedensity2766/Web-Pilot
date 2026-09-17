import { mimeMatchesExtension, normalizeContentType, sniffType } from '@webpilot/shared';

export type ExpectKind = 'image' | 'document' | 'any';

export interface VerificationInput {
  bytes: Uint8Array;
  /** `Content-Type` the server claimed. */
  declaredType?: string | null;
  /** Extension we intend to save the file with. */
  intendedExtension?: string | null;
  /** What the task expected to receive. */
  expect?: ExpectKind;
}

export interface VerificationResult {
  ok: boolean;
  /** Machine readable reason when `ok` is false. */
  reason?: 'empty' | 'mime_mismatch' | 'not_expected_kind' | 'unrecognised';
  /** Type detected from the bytes (authoritative). */
  mime: string;
  /** Extension matching the detected type, when known. */
  extension: string | null;
  /** True when the server's `Content-Type` disagreed with the bytes. */
  declaredMismatch: boolean;
  size: number;
}

const KIND_MIME_PREFIX: Record<Exclude<ExpectKind, 'any'>, string> = {
  image: 'image/',
  document: 'application/',
};

/**
 * Verifies what we actually downloaded: never trust the server's content type,
 * and reject thumbnails-of-error-pages (a very common failure mode when scraping
 * images from search results).
 */
export function verifyPayload(input: VerificationInput): VerificationResult {
  const size = input.bytes.byteLength;
  const sniffed = sniffType(input.bytes);
  const declared = normalizeContentType(input.declaredType);
  const mime = sniffed?.mime ?? declared;
  const extension = sniffed?.ext ?? null;
  const declaredMismatch = Boolean(declared) && sniffed !== null && declared !== sniffed.mime;

  if (size === 0) {
    return { ok: false, reason: 'empty', mime, extension, declaredMismatch, size };
  }

  // Check what the task expected *first*: a page that answers with HTML instead
  // of an image must be rejected, not happily saved as `something.html`.
  const expect = input.expect ?? 'any';
  if (expect !== 'any') {
    const prefix = KIND_MIME_PREFIX[expect];
    if (!mime.startsWith(prefix)) {
      return {
        ok: false,
        reason: 'not_expected_kind',
        mime,
        extension,
        declaredMismatch,
        size,
      };
    }
  }

  if (
    input.intendedExtension &&
    sniffed &&
    !mimeMatchesExtension(sniffed.mime, input.intendedExtension)
  ) {
    // The bytes are a different (known) type than the extension we chose (a
    // `.jpg` URL that really serves PNG) — the downloader fixes the extension
    // from `extension` instead of rejecting the file.
    return { ok: true, mime, extension, declaredMismatch: true, size };
  }

  return { ok: true, mime, extension, declaredMismatch, size };
}