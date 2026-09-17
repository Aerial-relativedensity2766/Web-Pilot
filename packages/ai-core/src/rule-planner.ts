import type { Action, ExtractAction, TaskPlan } from '@webpilot/schemas';
import { ACTION_CAPS } from '@webpilot/schemas';
import { nowIso } from '@webpilot/shared';
import type { PlannerInput } from './types';

export interface MediaIntent {
  count: number;
  query: string;
  download: boolean;
}

export interface ExtractionIntent {
  query: string;
  url: string | null;
}

/** Deterministic intent parser — always available, no weights needed. */
export function planWithRules(input: PlannerInput): TaskPlan {
  const prompt = input.prompt.trim();
  const startUrl = normalizeStartUrl(input.startUrl);
  const media = parseMediaIntent(prompt);
  if (media) return mediaPlan(prompt, startUrl, media);
  const extraction = parseExtractionIntent(prompt);
  if (extraction) return extractionPlan(prompt, startUrl, extraction);
  return fallbackPlan(prompt, startUrl);
}

export function parseMediaIntent(prompt: string): MediaIntent | null {
  const lowered = prompt.toLowerCase();
  const mediaWord = /\b(images?|pictures?|photos?|wallpapers?|icons?)\b/.exec(lowered);
  if (!mediaWord) return null;
  const count = parseCount(lowered) ?? 10;
  return {
    count: Math.min(Math.max(1, count), ACTION_CAPS.downloadCount),
    query: cleanQuery(lowered),
    download: /\b(download|save|fetch|collect|grab|get)\b/.test(lowered),
  };
}

export function parseExtractionIntent(prompt: string): ExtractionIntent | null {
  const lowered = prompt.toLowerCase();
  const match = /\b(extract|collect|find|gather|list|get|show)\b(.{1,160}?)\bfrom\b(.{1,300})/.exec(lowered);
  if (match) {
    return {
      query: (match[2] ?? '').trim().slice(0, 240) || prompt.trim().slice(0, 240),
      url: extractUrl(prompt),
    };
  }
  if (/\b(extract|articles?|products?|prices?|jobs?|titles?)\b/.test(lowered)) {
    return { query: prompt.trim().slice(0, 240), url: extractUrl(prompt) };
  }
  return null;
}

function mediaPlan(prompt: string, startUrl: string, intent: MediaIntent): TaskPlan {
  const steps: Action[] = [
    { type: 'navigate', url: startUrl },
    {
      type: 'type',
      target: { strategy: 'testid', value: 'search-input' },
      text: intent.query.slice(0, 200),
      submit: true,
    },
    { type: 'extract', target: 'images', query: `${intent.query} image`.slice(0, 240), limit: 200 },
  ];
  if (intent.download) {
    steps.push({ type: 'download', count: intent.count, query: `${intent.query} image`.slice(0, 240) });
  }
  return { goal: goalFor(prompt), steps, source: 'rule', warnings: [], createdAt: nowIso() };
}

function extractionPlan(prompt: string, startUrl: string, intent: ExtractionIntent): TaskPlan {
  const lower = intent.query.toLowerCase();
  const target: ExtractAction['target'] = /\bimages?\b/.test(lower)
    ? 'images'
    : /\blinks?\b|\burls?\b/.test(lower)
      ? 'links'
      : /\btables?\b|\bprices?\b|\bproducts?\b/.test(lower)
        ? 'tables'
        : 'text';
  return {
    goal: goalFor(prompt),
    steps: [
      { type: 'navigate', url: intent.url ?? startUrl },
      { type: 'extract', target, query: intent.query.slice(0, 240), limit: 200 },
    ],
        source: 'rule',
    warnings: [],
    createdAt: nowIso(),
  };
}

function fallbackPlan(prompt: string, startUrl: string): TaskPlan {
  const url = extractUrl(prompt) ?? startUrl;
  return {
    goal: goalFor(prompt),
    steps: [
      { type: 'navigate', url },
      { type: 'extract', target: 'text', query: prompt.slice(0, 240), limit: 200 },
    ],
        source: 'rule',
    warnings: [],
    createdAt: nowIso(),
  };
}

export function normalizeStartUrl(value?: string): string {
  if (value && /^https?:\/\//i.test(value.trim())) return value.trim();
  return 'http://127.0.0.1:3001/test-site/';
}

export function extractUrl(prompt: string): string | null {
  const match = /https?:\/\/[^\s"'<>]+/i.exec(prompt);
  return match ? match[0].replace(/[.,;!?)]+$/, '') : null;
}

export function parseCount(lowered: string): number | null {
  const digits = /(\d{1,3})\s*(images?|pictures?|photos?|items?|results?|files?)?/.exec(lowered);
  if (digits?.[1]) return Number(digits[1]);
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
  };
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(lowered)) return value;
  }
  return null;
}

export function cleanQuery(lowered: string): string {
  const stop = new Set([
    'find', 'search', 'get', 'give', 'show', 'fetch', 'download', 'save',
    'collect', 'grab', 'of', 'for', 'the', 'a', 'an', 'me', 'please',
    'from', 'web', 'internet', 'online', 'and', 'them', 'it', 'that',
    'images', 'image', 'pictures', 'picture', 'photos', 'photo',
  ]);
  const tokens = lowered
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !stop.has(t) && !/^\d+$/.test(t));
  return tokens.slice(0, 6).join(' ').trim() || 'images';
}

export function goalFor(prompt: string): string {
  return prompt.trim().slice(0, 400) || 'Complete the web task';
}
