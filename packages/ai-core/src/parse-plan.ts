import { ActionSchema, ACTION_CAPS, type Action } from '@webpilot/schemas';
import { slugify } from '@webpilot/shared';
import { goalFor, planWithRules } from './rule-planner';

export interface ParsedPlan {
  goal: string;
  steps: Action[];
  source: 'ai' | 'rule';
  warnings: string[];
}

/** Parses model output into validated actions; falls back to rules. */
export function parseModelOutput(raw: string, prompt: string): ParsedPlan {
  const fallback = (): ParsedPlan => {
    const rule = planWithRules({ prompt });
    return { goal: rule.goal, steps: rule.steps, source: 'rule', warnings: [] };
  };
  const candidate = extractJsonArray(raw);
  if (!candidate) {
    return { ...fallback(), warnings: ['no JSON array found in model output'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ...fallback(), warnings: ['model output was not valid JSON'] };
  }
  if (!Array.isArray(parsed)) {
    return { ...fallback(), warnings: ['model output was not an array'] };
  }
  const steps: Action[] = [];
  const warnings: string[] = [];
  for (const [index, entry] of parsed.slice(0, ACTION_CAPS.planSteps).entries()) {
    const validated = ActionSchema.safeParse(entry);
    if (validated.success) steps.push(validated.data);
    else warnings.push(`step ${index} rejected`);
  }
  if (steps.length === 0) {
    return { ...fallback(), warnings: [...warnings, 'no valid actions'] };
  }
  return { goal: goalFor(prompt), steps, source: 'ai', warnings };
}

export function extractJsonArray(raw: string): string | null {
  const flat = raw.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');
  const start = flat.indexOf('[');
  const end = flat.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  return flat.slice(start, end + 1);
}

/** Validates externally supplied steps the same way (API/replanner). */
export function validatePlanSteps(steps: readonly unknown[]): Action[] {
  const valid: Action[] = [];
  for (const step of steps) {
    const parsed = ActionSchema.safeParse(step);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

/** Slug for `tree-001.png` style filenames, derived from the goal. */
export function slugForGoal(goal: string): string {
  const cleaned = goal.replace(/\b(images?|pictures?|photos?|download|find|search)\b/gi, ' ').trim();
  return slugify(cleaned, 'download') || 'download';
}
