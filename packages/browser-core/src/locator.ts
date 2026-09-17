import type { Locator, Page } from 'playwright';
import { WebPilotError, type LocatorSpec, type LocatorStrategy } from '@webpilot/schemas';
import { loggerFor } from '@webpilot/shared';

const log = loggerFor('browser:locator');

export interface ResolvedLocator {
  locator: Locator;
  /** the candidate that actually matched (may differ from the requested spec) */
  spec: LocatorSpec;
  strategy: LocatorStrategy;
  /** how many elements matched before `.first()` was applied */
  matched: number;
  visible: boolean;
  /** every candidate attempted, in order — fed to the replanner on failure */
  tried: string[];
  url: string;
}

export function describeSpec(spec: LocatorSpec): string {
  if (spec.strategy === 'role') {
    return `role=${spec.role ?? spec.value}${spec.name ? ` name="${spec.name}"` : ''}`;
  }
  return `${spec.strategy}=${spec.value}${spec.nth !== undefined ? ` [${spec.nth}]` : ''}`;
}

/**
 * Maps a validated `LocatorSpec` onto the most resilient Playwright locator.
 * Only the `getBy*` family is used for the high level strategies — those follow
 * the accessibility tree instead of brittle DOM structure.
 */
export function locatorFor(page: Page, spec: LocatorSpec): Locator {
  const exact = spec.exact ?? false;
  let locator: Locator;
  switch (spec.strategy) {
    case 'testid':
      locator = page.getByTestId(spec.value);
      break;
    case 'role':
      locator = page.getByRole(
        (spec.role ?? spec.value) as Parameters<Page['getByRole']>[0],
        { ...(spec.name ? { name: spec.name } : {}), exact },
      );
      break;
    case 'label':
      locator = page.getByLabel(spec.value, { exact });
      break;
    case 'placeholder':
      locator = page.getByPlaceholder(spec.value, { exact });
      break;
    case 'alt':
      locator = page.getByAltText(spec.value, { exact });
      break;
    case 'title':
      locator = page.getByTitle(spec.value, { exact });
      break;
    case 'text':
      locator = page.getByText(spec.value, { exact });
      break;
    case 'xpath':
      locator = page.locator(`xpath=${spec.value}`);
      break;
    case 'css':
    default:
      locator = page.locator(spec.value);
      break;
  }
  return spec.nth !== undefined ? locator.nth(spec.nth) : locator;
}

const PLAIN_TOKEN = /^[\w][\w .:-]{0,60}$/;
const CSS_SAFE_TOKEN = /^[\w-]{1,60}$/;

function sameSpec(a: LocatorSpec, b: LocatorSpec): boolean {
  return (
    a.strategy === b.strategy &&
    a.value === b.value &&
    a.role === b.role &&
    a.name === b.name &&
    a.nth === b.nth
  );
}

/**
 * The resilient selector strategy, implemented deterministically:
 *
 *   1. data-testid        2. accessibility role      3. accessible name
 *   4. stable attributes  5. css                     6. text
 *
 * The requested strategy is tried first (the caller usually knows best), then
 * whatever alternatives can be derived from the same value. Candidate
 * generation is pure — the expensive `count()` probes happen in
 * `resolveLocator()` and stop at the first hit.
 */
export function candidateSpecs(spec: LocatorSpec, maxCandidates = 10): LocatorSpec[] {
  const candidates: LocatorSpec[] = [spec];
  const push = (candidate: LocatorSpec): void => {
    if (candidates.length >= maxCandidates) return;
    if (candidates.some((existing) => sameSpec(existing, candidate))) return;
    candidates.push(candidate);
  };

  const value = spec.value.trim();
  const base = { ...(spec.nth !== undefined ? { nth: spec.nth } : {}) };

  // An accessible-name hint is the strongest fallback signal, so honour it first.
  const name = spec.name?.trim();
  if (name && PLAIN_TOKEN.test(name)) {
    push({ strategy: 'role', value: name, role: spec.role ?? 'button', name, ...base });
    push({ strategy: 'text', value: name, ...base });
  }
  if (spec.role && PLAIN_TOKEN.test(value)) {
    push({ strategy: 'role', value, role: spec.role, name: name ?? value, ...base });
  }

  if (CSS_SAFE_TOKEN.test(value)) push({ strategy: 'testid', value, ...base });

  if (PLAIN_TOKEN.test(value)) {
    push({ strategy: 'role', value, role: 'button', name: value, ...base });
    push({ strategy: 'role', value, role: 'link', name: value, ...base });
    push({ strategy: 'label', value, ...base });
    push({ strategy: 'text', value, ...base });
    if (CSS_SAFE_TOKEN.test(value)) {
      push({ strategy: 'css', value: `[data-testid="${value}"]`, ...base });
      push({ strategy: 'css', value: `[name="${value}"]`, ...base });
      push({ strategy: 'css', value: `[aria-label="${value}"]`, ...base });
    }
  }

  // An id-like value is often passed as a raw css selector by the AI.
  if (/^#[\w-]{1,60}$/.test(value)) {
    push({ strategy: 'css', value: `[id="${value.slice(1)}"]`, ...base });
    push({ strategy: 'testid', value: value.slice(1), ...base });
  }

  return candidates;
}

async function safeCount(locator: Locator): Promise<number> {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

/**
 * Resolves a spec to a concrete locator, walking the candidate list until
 * something matches. Prefers visible matches, falls back to attached ones so
 * Playwright's own actionability checks produce the final error message.
 */
export async function resolveLocator(
  page: Page,
  spec: LocatorSpec,
  options: { timeoutMs?: number; requireVisible?: boolean } = {},
): Promise<ResolvedLocator> {
  const timeoutMs = Math.max(200, options.timeoutMs ?? 5_000);
  const tried: string[] = [];
  let attachedFallback: ResolvedLocator | null = null;

  for (const candidate of candidateSpecs(spec)) {
    let locator: Locator;
    try {
      locator = locatorFor(page, candidate);
    } catch (error) {
      tried.push(`${describeSpec(candidate)} (invalid: ${(error as Error).message})`);
      continue;
    }

    const count = await safeCount(locator);
    if (count === 0) {
      tried.push(describeSpec(candidate));
      continue;
    }

    const resolved = count > 1 && candidate.nth === undefined ? locator.first() : locator;
    const resolvedLocator: ResolvedLocator = {
      locator: resolved,
      spec: candidate,
      strategy: candidate.strategy,
      matched: count,
      visible: false,
      tried,
      url: page.url(),
    };

    try {
      await resolved.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 3_000) });
      resolvedLocator.visible = true;
      return resolvedLocator;
    } catch {
      resolvedLocator.visible = await resolved.isVisible().catch(() => false);
      if (resolvedLocator.visible) return resolvedLocator;
      if (!attachedFallback) attachedFallback = resolvedLocator;
      tried.push(`${describeSpec(candidate)} (found but not visible)`);
    }
  }

  if (attachedFallback) {
    log.warn('using non-visible element', {
      spec: describeSpec(spec),
      url: attachedFallback.url,
    });
    return attachedFallback;
  }

  throw new WebPilotError(
    'SELECTOR_NOT_FOUND',
    `Could not find an element for ${describeSpec(spec)} on ${page.url()}`,
    {
      recoverable: true,
      details: { tried, url: page.url(), requested: spec },
    },
  );
}

/** Candidate locators, for DOM inspection / replan diagnostics. */
export function candidateLocators(
  page: Page,
  spec: LocatorSpec,
): Array<{ spec: LocatorSpec; locator: Locator }> {
  return candidateSpecs(spec).map((candidate) => ({
    spec: candidate,
    locator: locatorFor(page, candidate),
  }));
}
