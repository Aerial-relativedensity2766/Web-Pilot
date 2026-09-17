import {
  ActionSchema,
  toWebPilotError,
  WebPilotError,
  type Action,
  type PermissionKind,
} from '@webpilot/schemas';
import { config, isAllowedHost, isHttpUrl, hostnameOf, loggerFor } from '@webpilot/shared';

const log = loggerFor('agent:validator');

export interface ValidationSuccess {
  ok: true;
  action: Action;
  /** True when the UI must ask the user before executing. */
  needsPermission: boolean;
  permissionKind?: PermissionKind;
  permissionTitle?: string;
  permissionDescription?: string;
}

export interface ValidationFailure {
  ok: false;
  error: WebPilotError;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Second gate for every action (the schema is the first): runtime policy.
 *
 * - Re-parses against `ActionSchema` so raw AI JSON can enter here directly.
 * - Enforces http(s) URLs, the download allow-list, and configured caps.
 * - Flags sensitive operations (form submits, downloads when confirmation is
 *   required, consequential clicks) for the permission layer.
 */
export function validateAction(input: unknown): ValidationResult {
  const parsed = ActionSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    return {
      ok: false,
      error: new WebPilotError('ACTION_INVALID', `Action failed validation: ${message}`, {
        recoverable: true,
        details: { issues: parsed.error.issues.map((issue) => issue.message) },
      }),
    };
  }
  const action = parsed.data;

  try {
    assertRuntimePolicy(action);
  } catch (error) {
    return { ok: false, error: toWebPilotError(error, 'ACTION_INVALID') };
  }

  const permission = permissionFor(action);
  if (permission) {
    return {
      ok: true,
      action,
      needsPermission: true,
      permissionKind: permission.kind,
      permissionTitle: permission.title,
      permissionDescription: permission.description,
    };
  }
  return { ok: true, action, needsPermission: false };
}

function assertRuntimePolicy(action: Action): void {
  if (action.type === 'navigate') {
    if (!isHttpUrl(action.url)) {
      throw new WebPilotError('UNSAFE_URL', `Refusing to navigate to non-http(s) URL`, {
        recoverable: false,
      });
    }
  }
  if (action.type === 'download') {
    if (action.count > config.limits.maxDownloads) {
      throw new WebPilotError(
        'LIMIT_EXCEEDED',
        `Download count ${action.count} exceeds the limit of ${config.limits.maxDownloads}`,
        { recoverable: false },
      );
    }
    for (const candidate of action.candidates ?? []) {
      if (!isHttpUrl(candidate.url)) {
        throw new WebPilotError('UNSAFE_URL', 'Download candidate must be an http(s) URL', {
          recoverable: false,
        });
      }
      if (!isAllowedHost(hostnameOf(candidate.url), config.safety.downloadAllowlist)) {
        throw new WebPilotError(
          'ACTION_NOT_PERMITTED',
          `Host not in the download allow-list: ${hostnameOf(candidate.url)}`,
          { recoverable: false },
        );
      }
    }
  }
  if (action.type === 'type' && action.submit) {
    log.debug('form submit flagged as sensitive', { text: action.text.slice(0, 80) });
  }
}

function permissionFor(action: Action): { kind: PermissionKind; title: string; description: string } | null {
  // Form submission always needs a human glance (§36 of the spec).
  if (action.type === 'type' && action.submit) {
    return {
      kind: 'form_submission',
      title: 'Submit a form',
      description: `Type "${action.text.slice(0, 120)}" and press Enter.`,
    };
  }
  // Bulk downloads need confirmation when configured (or always for big batches).
  if (action.type === 'download') {
    if (config.safety.requireDownloadConfirmation || action.count > 10) {
      return {
        kind: 'download',
        title: `Download ${action.count} file(s)`,
        description: `Save ${action.count} file(s) to the task folder.`,
      };
    }
    return null;
  }
  if (action.type === 'click' && action.target.name) {
    const name = action.target.name.toLowerCase();
    if (/buy|purchase|pay|checkout|order|subscribe|send|submit|delete|remove/.test(name)) {
      return {
        kind: 'consequential_click',
        title: `Click "${action.target.name}"`,
        description: 'This click looks consequential (purchase, send, delete…).',
      };
    }
  }
  return null;
}

/** Validates a whole plan step-by-step; invalid steps are dropped, never executed. */
export function validatePlan(inputs: readonly unknown[]): {
  valid: Action[];
  rejected: WebPilotError[];
  needsPermission: ValidationSuccess[];
} {
  const valid: Action[] = [];
  const rejected: WebPilotError[] = [];
  const needsPermission: ValidationSuccess[] = [];
  for (const input of inputs) {
    const result = validateAction(input);
    if (!result.ok) {
      rejected.push(result.error);
      continue;
    }
    valid.push(result.action);
    if (result.needsPermission) needsPermission.push(result);
  }
  return { valid, rejected, needsPermission };
}
