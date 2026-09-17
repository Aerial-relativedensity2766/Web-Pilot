/**
 * Constrained system prompt for the local planner model.
 *
 * The model only ever *decides* — it never executes. Every action it produces
 * must validate against `ActionSchema` before reaching Playwright.
 */
export const PLANNER_SYSTEM_PROMPT = `You are WebPilot's task planner, a local browser-automation assistant.

You can ONLY use these actions (any other "type" is rejected):
- navigate: open a page. Fields: url (absolute http(s) URL).
- click: click an element. Fields: target { strategy, value, role?, name? }.
- type: type text into an input. Fields: target, text, submit? (true presses Enter).
- press: press a keyboard key. Fields: key (Enter, Escape, Tab, arrows…).
- scroll: scroll the page. Fields: direction (up|down|top|bottom), amount?.
- extract: read content from the page. Fields: target (images|links|text|buttons|inputs|metadata|structuredData|tables), query?, limit?.
- download: save resources found on the page. Fields: count, query?.
- wait: pause. Fields: ms? (max 30000).

Rules:
- Never generate JavaScript, shell commands, CSS selectors with side effects, or anything outside the action list.
- Prefer accessible locators: strategy "testid" (data-testid value), "role" (with role + name), "placeholder", "text". Use "css" only as a last resort.
- Return STRUCTURED JSON ONLY: a JSON array of action objects, no prose, no markdown fences, no commentary.
- Keep plans short (at most 10 steps). The agent observes the page between steps and can replan.
- For "find N images of X and download them": navigate to a search page, type the query with submit true, extract images with query "X image", then download N with the same query.`;

export function buildPlannerUserMessage(goal: string, contextSummary?: string): string {
  const context = contextSummary?.trim()
    ? `\n\nCURRENT STATE (compact observation, not raw HTML):\n${contextSummary.trim()}\n`
    : '';
  return `User task:\n${goal}${context}\nReturn the plan as a JSON array of actions.`;
}

/**
 * Builds the compact context block sent to the model (§54 of the spec).
 * Only counts and short labels — never raw HTML — to keep inference cheap.
 */
export function buildContextSummary(input: {
  url?: string | null;
  title?: string;
  task?: string | null;
  interactive?: ReadonlyArray<{ kind: string; label: string }>;
  linkCount?: number;
  imageCount?: number;
  lastAction?: string | null;
  lastResult?: string | null;
}): string {
  const lines: string[] = [];
  if (input.task) lines.push(`TASK:\n${input.task}`);
  if (input.url) lines.push(`URL:\n${input.url}`);
  if (input.title) lines.push(`TITLE:\n${input.title}`);
  const counts: string[] = [];
  if (input.linkCount !== undefined) counts.push(`links: ${input.linkCount}`);
  if (input.imageCount !== undefined) counts.push(`images: ${input.imageCount}`);
  if (counts.length > 0) lines.push(`COUNTS:\n${counts.join(', ')}`);
  const interactive = (input.interactive ?? []).slice(0, 12);
  if (interactive.length > 0) {
    lines.push(`CONTROLS:\n${interactive.map((item) => `- ${item.kind}: ${item.label}`.slice(0, 120)).join('\n')}`);
  }
  if (input.lastAction) lines.push(`LAST ACTION:\n${input.lastAction}`);
  if (input.lastResult) lines.push(`LAST RESULT:\n${input.lastResult}`);
  lines.push('AVAILABLE ACTIONS:\nnavigate, click, type, press, scroll, extract, download, wait');
  return lines.join('\n\n');
}
