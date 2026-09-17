/** Byte size formatting shared by the API responses and the UI. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1_024)));
  const value = bytes / 1_024 ** exponent;
  const digits = exponent === 0 ? 0 : fractionDigits;
  return `${value.toFixed(digits)} ${UNITS[exponent]}`;
}

export function megabytesToBytes(megabytes: number): number {
  return Math.max(0, megabytes) * 1_024 * 1_024;
}

export function bytesToMegabytes(bytes: number): number {
  return Math.max(0, bytes) / (1_024 * 1_024);
}