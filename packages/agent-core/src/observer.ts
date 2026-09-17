import { buildContextSummary } from '@webpilot/ai-core';
import type { AgentState, PageState } from '@webpilot/schemas';

/**
 * Turns browser state + agent state into the compact summary the model sees.
 * Never includes HTML — only counts, short labels and the last outcome.
 */
export function observePage(taskGoal: string, page: PageState, state: AgentState): string {
  return buildContextSummary({
    url: page.url,
    title: page.title,
    task: taskGoal,
    interactive: page.interactive.map((item) => ({
      kind: item.kind,
      label: item.testId ? `${item.label} [${item.testId}]` : item.label,
    })),
    linkCount: page.links,
    imageCount: page.images,
    lastAction: state.lastActionSummary,
    lastResult: state.lastResultSummary,
  });
}

/** One-line extraction digest for the timeline and the AI context. */
export function summarizeExtraction(input: {
  target: string;
  count: number;
  selected?: number;
  query?: string | null;
}): string {
  const scope = input.query ? ` for "${input.query}"` : '';
  const selected = input.selected !== undefined ? `, selected ${input.selected}` : '';
  return `extracted ${input.count} ${input.target}${scope}${selected}`;
}

export function summarizeDownload(input: {
  completed: number;
  requested: number;
  duplicates?: number;
  failed?: number;
}): string {
  const parts = [`downloaded ${input.completed}/${input.requested}`];
  if (input.duplicates) parts.push(`${input.duplicates} duplicate(s) skipped`);
  if (input.failed) parts.push(`${input.failed} failed`);
  return parts.join(', ');
}
