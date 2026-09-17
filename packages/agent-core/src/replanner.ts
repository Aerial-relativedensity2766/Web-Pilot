import type { Action, LocatorSpec } from '@webpilot/schemas';
import { WebPilotError } from '@webpilot/schemas';

/**
 * Picks an alternative when an action fails (§18 of the spec):
 * selector failure → degrade the locator strategy step by step
 * (testid → role → name → css → text); anything else → caller decides
 * retry vs replan vs abort.
 */
export function replanForFailure(input: {
  action: Action;
  error: WebPilotError | Error;
  attempt: number;
}): { strategy: 'retry_same' | 'retry_alternative' | 'abort'; alternative?: Action; reason: string } {
  const code = input.error instanceof WebPilotError ? input.error.code : 'UNKNOWN';
  const recoverable = input.error instanceof WebPilotError ? input.error.recoverable : true;

  if (!recoverable || input.attempt >= 3) {
    return { strategy: 'abort', reason: `${code} is not recoverable after ${input.attempt} attempt(s)` };
  }

  if (
    (code === 'SELECTOR_NOT_FOUND' || code === 'ACTION_TIMEOUT') &&
    (input.action.type === 'click' || input.action.type === 'type')
  ) {
    const degraded = degradeLocator(input.action.target);
    if (degraded) {
      return {
        strategy: 'retry_alternative',
        alternative: { ...input.action, target: degraded } as Action,
        reason: `degraded locator from ${input.action.target.strategy} to ${degraded.strategy}`,
      };
    }
  }

  if (code === 'NAVIGATION_FAILED' || code === 'NETWORK_FAILED' || code === 'ACTION_TIMEOUT') {
    return { strategy: 'retry_same', reason: `${code} looks transient, retrying` };
  }

  if (code === 'AI_INVALID_JSON' || code === 'ACTION_INVALID') {
    return { strategy: 'retry_alternative', reason: 'invalid action, planner should try again' };
  }

  return { strategy: 'abort', reason: `${code} has no automatic recovery` };
}

/** One step down the selector robustness ladder (§20 of the spec). */
export function degradeLocator(spec: LocatorSpec): LocatorSpec | null {
  switch (spec.strategy) {
    case 'testid':
      if (spec.role) return { strategy: 'role', value: spec.value, role: spec.role, name: spec.name };
      if (spec.name) return { strategy: 'text', value: spec.name };
      return { strategy: 'css', value: `[data-testid="${spec.value}"]`, name: spec.name };
    case 'role':
      if (spec.name) return { strategy: 'text', value: spec.name };
      return { strategy: 'css', value: spec.value, name: spec.name };
    case 'placeholder':
    case 'label':
      return { strategy: 'text', value: spec.value };
    case 'css':
      if (spec.name) return { strategy: 'text', value: spec.name };
      return null;
    case 'text':
    case 'xpath':
      return null;
    default:
      return null;
  }
}
