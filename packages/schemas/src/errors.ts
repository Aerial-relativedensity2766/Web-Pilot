import { z } from 'zod';

/**
 * Every failure becomes one of these structured codes.
 * `recoverable` drives the recovery strategy: retry → replan → ask the user.
 */
export const ERROR_CODES = [
  'ACTION_INVALID',
  'ACTION_NOT_PERMITTED',
  'ACTION_TIMEOUT',
  'AI_INVALID_JSON',
  'AI_MODEL_UNAVAILABLE',
  'AI_TIMEOUT',
  'BROWSER_LAUNCH_FAILED',
  'BROWSER_NOT_READY',
  'CONFIG_INVALID',
  'DOWNLOAD_FAILED',
  'DUPLICATE_FILE',
  'EXTRACTION_FAILED',
  'FILE_TOO_LARGE',
  'LIMIT_EXCEEDED',
  'MIME_MISMATCH',
  'NAVIGATION_FAILED',
  'NETWORK_FAILED',
  'NO_CANDIDATES',
  'PERMISSION_DENIED',
  'PERMISSION_TIMEOUT',
  'SELECTOR_NOT_FOUND',
  'TASK_CANCELLED',
  'TASK_TIMEOUT',
  'UNSAFE_URL',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const WebPilotErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: z.string(),
  recoverable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type WebPilotErrorPayload = z.infer<typeof WebPilotErrorSchema>;

/**
 * Error thrown by every WebPilot package. Carries the structured code the
 * recovery layer needs to make a decision.
 */
export class WebPilotError extends Error {
  readonly code: ErrorCode;
  readonly recoverable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      recoverable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WebPilotError';
    this.code = code;
    this.recoverable = options.recoverable ?? DEFAULT_RECOVERABLE[code];
    this.details = options.details ?? {};
  }

  toPayload(): WebPilotErrorPayload {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }

  toJSON(): WebPilotErrorPayload {
    return this.toPayload();
  }
}

/** Which failures are worth another attempt by default. */
const DEFAULT_RECOVERABLE: Record<ErrorCode, boolean> = {
  ACTION_INVALID: true,
  ACTION_NOT_PERMITTED: false,
  ACTION_TIMEOUT: true,
  AI_INVALID_JSON: true,
  AI_MODEL_UNAVAILABLE: false,
  AI_TIMEOUT: true,
  BROWSER_LAUNCH_FAILED: false,
  BROWSER_NOT_READY: true,
  CONFIG_INVALID: false,
  DOWNLOAD_FAILED: true,
  DUPLICATE_FILE: true,
  EXTRACTION_FAILED: true,
  FILE_TOO_LARGE: false,
  LIMIT_EXCEEDED: false,
  MIME_MISMATCH: true,
  NAVIGATION_FAILED: true,
  NETWORK_FAILED: true,
  NO_CANDIDATES: true,
  PERMISSION_DENIED: false,
  PERMISSION_TIMEOUT: false,
  SELECTOR_NOT_FOUND: true,
  TASK_CANCELLED: false,
  TASK_TIMEOUT: false,
  UNSAFE_URL: false,
  UNKNOWN: true,
};

export function isWebPilotError(value: unknown): value is WebPilotError {
  return value instanceof WebPilotError;
}

export function toWebPilotError(value: unknown, fallbackCode: ErrorCode = 'UNKNOWN'): WebPilotError {
  if (isWebPilotError(value)) return value;
  if (value instanceof Error) {
    return new WebPilotError(fallbackCode, value.message, {
      details: { name: value.name },
      cause: value,
    });
  }
  return new WebPilotError(fallbackCode, String(value));
}

export function toErrorPayload(value: unknown): WebPilotErrorPayload {
  return toWebPilotError(value).toPayload();
}

/** Flatten Zod issues into something a human (or the AI) can act on. */
export function validationIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function validationErrorMessage(error: z.ZodError): string {
  return `Action failed validation: ${validationIssues(error).join('; ')}`;
}