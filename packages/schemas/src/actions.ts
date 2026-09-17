import { z } from 'zod';
import { ACTION_CAPS } from './limits';

/**
 * The complete vocabulary the AI is allowed to use.
 *
 * The model never generates JavaScript, shell commands or selectors that are
 * executed directly — it only produces values that match these schemas.
 */
export const ACTION_TYPES = [
  'navigate',
  'click',
  'type',
  'press',
  'scroll',
  'extract',
  'download',
  'wait',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const ActionTypeSchema = z.enum(ACTION_TYPES);

/** Locator strategies, tried in this order of resilience (see browser-core). */
export const LOCATOR_STRATEGIES = [
  'testid',
  'role',
  'label',
  'placeholder',
  'alt',
  'title',
  'text',
  'css',
  'xpath',
] as const;

export type LocatorStrategy = (typeof LOCATOR_STRATEGIES)[number];

export const LocatorStrategySchema = z.enum(LOCATOR_STRATEGIES);

/**
 * A resolved, permissive description of how to find an element.
 * The executor maps it onto Playwright's `getBy*` family where possible.
 */
export const LocatorSpecSchema = z
  .strictObject({
    strategy: LocatorStrategySchema.default('css'),
    value: z.string().min(1).max(ACTION_CAPS.selectorLength),
    /** ARIA role, required for (and only used by) the `role` strategy. */
    role: z.string().min(1).max(64).optional(),
    /** Accessible name, used by the `role` strategy. */
    name: z.string().min(1).max(256).optional(),
    /** Match the accessible name exactly instead of substring. */
    exact: z.boolean().optional(),
    /** Pick the n-th match (0 based) when several elements are identical. */
    nth: z.number().int().min(0).max(500).optional(),
  })
  .refine((spec) => spec.strategy !== 'role' || Boolean(spec.role ?? spec.value), {
    message: 'role strategy requires a role',
  });

export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

/** Accepts only absolute http(s) URLs — blocks `javascript:`, `file:`, `data:` … */
export const HttpUrlSchema = z
  .string()
  .min(1)
  .max(ACTION_CAPS.urlLength)
  .refine((value) => isHttpUrl(value), {
    message: 'must be an absolute http(s) URL',
  });

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Keys the executor is willing to press. Anything else is rejected. */
export const ALLOWED_KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Space',
] as const;

const KeySchema = z
  .string()
  .min(1)
  .max(ACTION_CAPS.keyLength)
  .refine(
    (key) =>
      (ALLOWED_KEYS as readonly string[]).includes(key) || /^[A-Za-z0-9]{1,3}$/.test(key),
    { message: 'key is not in the allow-list' },
  );

const ReasonSchema = z.string().min(1).max(300);

export const NavigateActionSchema = z.strictObject({
  type: z.literal('navigate'),
  url: HttpUrlSchema,
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
  reason: ReasonSchema.optional(),
});

export const ClickActionSchema = z.strictObject({
  type: z.literal('click'),
  target: LocatorSpecSchema,
  button: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
  reason: ReasonSchema.optional(),
});

export const TypeActionSchema = z.strictObject({
  type: z.literal('type'),
  target: LocatorSpecSchema,
  text: z.string().max(ACTION_CAPS.textLength),
  /** clear the field before typing (default true) */
  clear: z.boolean().optional(),
  /** press Enter afterwards — treated as a sensitive (form submit) action */
  submit: z.boolean().optional(),
  reason: ReasonSchema.optional(),
});

export const PressActionSchema = z.strictObject({
  type: z.literal('press'),
  key: KeySchema,
  target: LocatorSpecSchema.optional(),
  reason: ReasonSchema.optional(),
});

export const ScrollActionSchema = z.strictObject({
  type: z.literal('scroll'),
  direction: z.enum(['up', 'down', 'top', 'bottom']),
  amount: z.number().int().min(50).max(ACTION_CAPS.scrollAmount).optional(),
  target: LocatorSpecSchema.optional(),
  reason: ReasonSchema.optional(),
});

export const EXTRACT_TARGETS = [
  'images',
  'links',
  'text',
  'buttons',
  'inputs',
  'metadata',
  'structuredData',
  'tables',
] as const;

export type ExtractTarget = (typeof EXTRACT_TARGETS)[number];

export const ExtractActionSchema = z.strictObject({
  type: z.literal('extract'),
  target: z.enum(EXTRACT_TARGETS),
  /** semantic query used later for MiniLM ranking (e.g. "tree image") */
  query: z.string().min(1).max(ACTION_CAPS.queryLength).optional(),
  /** optional extra CSS selector to narrow the scan */
  selector: z.string().min(1).max(ACTION_CAPS.selectorLength).optional(),
  limit: z.number().int().min(1).max(ACTION_CAPS.extractLimit).optional(),
  reason: ReasonSchema.optional(),
});

export const DownloadCandidateSchema = z.strictObject({
  url: HttpUrlSchema,
  filename: z.string().min(1).max(180).optional(),
  alt: z.string().max(300).optional(),
  sourcePage: HttpUrlSchema.optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
});

export type DownloadCandidate = z.infer<typeof DownloadCandidateSchema>;

export const DownloadActionSchema = z.strictObject({
  type: z.literal('download'),
  /** number of resources the task wants */
  count: z.number().int().min(1).max(ACTION_CAPS.downloadCount),
  /** semantic query used to rank candidates before downloading */
  query: z.string().min(1).max(ACTION_CAPS.queryLength).optional(),
  /** explicit candidate list; when omitted the engine ranks observed candidates */
  candidates: z
    .array(DownloadCandidateSchema)
    .max(ACTION_CAPS.downloadCount)
    .optional(),
  /** sub directory inside the task folder (slugified, no traversal) */
  targetDir: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-_]*$/)
    .optional(),
  reason: ReasonSchema.optional(),
});

export const WaitActionSchema = z.strictObject({
  type: z.literal('wait'),
  ms: z.number().int().min(0).max(ACTION_CAPS.waitMs).optional(),
  forSelector: LocatorSpecSchema.optional(),
  reason: ReasonSchema.optional(),
});

/**
 * The single source of truth for "what the agent may do".
 * Anything not matching this union is rejected with `ACTION_INVALID`.
 */
export const ActionSchema = z.discriminatedUnion('type', [
  NavigateActionSchema,
  ClickActionSchema,
  TypeActionSchema,
  PressActionSchema,
  ScrollActionSchema,
  ExtractActionSchema,
  DownloadActionSchema,
  WaitActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;
export type NavigateAction = z.infer<typeof NavigateActionSchema>;
export type ClickAction = z.infer<typeof ClickActionSchema>;
export type TypeAction = z.infer<typeof TypeActionSchema>;
export type PressAction = z.infer<typeof PressActionSchema>;
export type ScrollAction = z.infer<typeof ScrollActionSchema>;
export type ExtractAction = z.infer<typeof ExtractActionSchema>;
export type DownloadAction = z.infer<typeof DownloadActionSchema>;
export type WaitAction = z.infer<typeof WaitActionSchema>;

/**
 * Actions that may have consequences for the user, and therefore go through the
 * permission manager before execution.
 */
export function sensitiveActionReason(action: Action): string | null {
  switch (action.type) {
    case 'type':
      return action.submit ? 'form submission' : null;
    case 'click':
      return looksLikeConsequentialClick(action)
        ? 'potentially consequential click'
        : null;
    default:
      return null;
  }
}

export function isSensitiveAction(action: Action): boolean {
  return sensitiveActionReason(action) !== null;
}

const CONSEQUENTIAL_CLICK_PATTERN =
  /\b(buy|purchase|pay|checkout|order|subscribe|sign\s?up|sign\s?in|log\s?in|delete|remove|unsubscribe|send|confirm|apply|transfer|donate)\b/i;

function looksLikeConsequentialClick(action: ClickAction): boolean {
  const haystack = [action.target.value, action.target.name, action.target.role]
    .filter(Boolean)
    .join(' ');
  return CONSEQUENTIAL_CLICK_PATTERN.test(haystack);
}

/** Human readable one-liner used in logs, events and the UI timeline. */
export function describeAction(action: Action): string {
  switch (action.type) {
    case 'navigate':
      return `navigate to ${action.url}`;
    case 'click':
      return `click ${action.target.strategy}=${action.target.value}`;
    case 'type':
      return `type into ${action.target.strategy}=${action.target.value}`;
    case 'press':
      return `press ${action.key}`;
    case 'scroll':
      return `scroll ${action.direction}`;
    case 'extract':
      return `extract ${action.target}`;
    case 'download':
      return `download ${action.count} resource(s)`;
    case 'wait':
      return action.forSelector
        ? `wait for ${action.forSelector.value}`
        : `wait ${action.ms ?? 1_000}ms`;
  }
}

