import { deflateSync } from 'node:zlib';

/**
 * Minimal PNG encoder used by the test site.
 *
 * Real PNG bytes matter: the downloader sniffs magic numbers, so fixture images
 * let us assert that declared `Content-Type` is cross-checked against content.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** Encodes a solid colour truecolour PNG. */
export function encodePngImage(
  width: number,
  height: number,
  color: [number, number, number],
): Uint8Array {
  const safeWidth = Math.max(1, Math.min(2_000, Math.trunc(width)));
  const safeHeight = Math.max(1, Math.min(2_000, Math.trunc(height)));

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, safeWidth);
  ihdrView.setUint32(4, safeHeight);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const raw = new Uint8Array(safeHeight * (1 + safeWidth * 3));
  let offset = 0;
  for (let y = 0; y < safeHeight; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < safeWidth; x += 1) {
      // subtle horizontal gradient keeps every image visually distinct
      const shade = Math.round((x / safeWidth) * 40);
      raw[offset] = Math.min(255, color[0] + shade);
      raw[offset + 1] = Math.min(255, color[1] + shade);
      raw[offset + 2] = Math.min(255, color[2] + shade);
      offset += 3;
    }
  }

  const idat = new Uint8Array(deflateSync(raw));
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}

/** 1x1 GIF (transparent) used as the tracking beacon fixture. */
export const TRACKING_PIXEL_GIF: Uint8Array = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

/** Repeating PNG-ish payload used to exceed the download size limit. */
export function oversizedPayload(bytes: number): Uint8Array {
  const size = Math.max(1_024, Math.trunc(bytes));
  const buffer = new Uint8Array(size);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let index = 8; index < size; index += 1) {
    buffer[index] = index % 251;
  }
  return buffer;
}