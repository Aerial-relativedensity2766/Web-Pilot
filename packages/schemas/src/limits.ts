/**
 * Hard structural caps for AI-generated actions.
 *
 * These are *schema level* limits: anything outside them is rejected outright by
 * Zod before it ever reaches the executor. Runtime (user configurable) limits
 * such as `MAX_DOWNLOADS` live in `@webpilot/shared` config and are enforced a
 * second time by the action validator.
 */
export const ACTION_CAPS = {
  /** longest accepted free text for a `type` action */
  textLength: 2_000,
  /** longest accepted URL */
  urlLength: 2_048,
  /** longest accepted selector / locator value */
  selectorLength: 512,
  /** longest accepted free-form query */
  queryLength: 240,
  /** max wait time in milliseconds */
  waitMs: 30_000,
  /** max pixels for a single scroll step */
  scrollAmount: 10_000,
  /** max items a single `extract` action may return */
  extractLimit: 500,
  /** max items a single `download` action may request */
  downloadCount: 200,
  /** max keys of a single `press` action */
  keyLength: 40,
  /** max steps in a plan produced by the planner */
  planSteps: 30,
} as const;
