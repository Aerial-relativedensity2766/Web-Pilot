import { WebPilotError } from '@webpilot/schemas';

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

export function nowMs(): number {
  return Date.now();
}

/** Milliseconds since an ISO timestamp (or since `Date.now()` when omitted). */
export function elapsedMs(startedAt?: string | number): number {
  if (startedAt === undefined) return 0;
  const start = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  if (Number.isNaN(start)) return 0;
  return Date.now() - start;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Rejects with a typed timeout error instead of hanging forever. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = `Operation timed out after ${ms}ms`,
  code: ConstructorParameters<typeof WebPilotError>[0] = 'ACTION_TIMEOUT',
): Promise<T> {
  if (ms <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WebPilotError(code, message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

/** Retries an async operation with linear backoff. */
export async function retry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; onError?: (error: unknown, attempt: number) => void } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 250;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      options.onError?.(error, attempt);
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}