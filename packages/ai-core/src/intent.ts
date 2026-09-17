import type { TaskPlan } from '@webpilot/schemas';
import type { PlannerInput, PlannerIntent } from './types';
import { planWithRules } from './rule-planner';

/** Backwards-compatible re-export: detailed intent parsing lives in rule-planner. */
export type { PlannerIntent };

export function parseIntent(prompt: string): PlannerIntent {
  const normalized = prompt.trim();
  const lowered = normalized.toLowerCase();
  const hasMedia = /\b(images?|pictures?|photos?|wallpapers?|icons?)\b/.test(lowered);
  const countMatch = /(\d{1,3})/.exec(lowered);
  const count = countMatch?.[1] ? Math.min(200, Math.max(1, Number(countMatch[1]))) : 10;
  const subject = subjectFor(normalized);
  if (hasMedia) return { kind: 'collect_images', count, subject };
  if (/\b(articles?|research|papers?|news)\b/.test(lowered)) return { kind: 'research', count, subject };
  if (/\b(extract|products?|prices?|jobs?|tables?|list)\b/.test(lowered)) {
    return { kind: 'extract_data', count, subject };
  }
  if (/\b(open|go to|navigate|visit)\b/.test(lowered)) return { kind: 'navigate_only', count: 1, subject };
  return { kind: 'general', count, subject };
}

function subjectFor(prompt: string): string {
  const withoutUrl = prompt.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  return withoutUrl.slice(0, 120) || prompt.slice(0, 120);
}

export function planFromIntent(input: PlannerInput): TaskPlan {
  return planWithRules(input);
}

