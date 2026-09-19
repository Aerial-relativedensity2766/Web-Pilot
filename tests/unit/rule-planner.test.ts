/**
 * Offline regression tests for the deterministic rule planner.
 *
 * These cases lock current supported behavior (navigation / extraction /
 * download, plus empty and ambiguous input). They never load Transformers.js,
 * embeddings, or a browser — only `planWithRules` / `parseIntent` and the
 * related pure helpers exported from `@webpilot/ai-core`.
 *
 * Documented current-behavior notes (not fixed in this PR):
 * - Media keywords (`images`, `pictures`, …) win over “extract X from URL”,
 *   so a prompt URL is ignored for navigation on the media path. Media plans
 *   always type into the local fixture `search-input` and navigate `startUrl`
 *   (default: the test-site), not `extractUrl(prompt)`.
 * - `parseIntent` kinds (`navigate_only`, `research`, …) do not change the
 *   plan: `planFromIntent` is `planWithRules`. There is no navigate-only plan;
 *   navigation prompts still append a text `extract`.
 * - `parseCount` takes the first 1–3 digit run, including digits inside an
 *   IP / port (`127.0.0.1:3001` → 127) or `1000` → 100. Word counts are
 *   consulted only when no digits match. `parseIntent` does not understand
 *   word counts (`twenty` → default 10). Word-number tokens stay in
 *   `cleanQuery` (`save five cat pictures` → type `five cat`).
 * - A URL path that contains an extraction keyword (`/products`) is treated
 *   as extraction even when the prompt is a navigate verb.
 * - Empty / whitespace-only prompts still emit a fallback plan whose extract
 *   `query` is `""`, which `ActionSchema` / `TaskPlanSchema` reject (`min(1)`).
 * - Trailing `. , ; ! ? )` are stripped from extracted URLs; `javascript:` /
 *   relative / ftp start URLs fall back to the local fixture.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_CAPS,
  ActionSchema,
  TaskPlanSchema,
  type Action,
  type TaskPlan,
} from '@webpilot/schemas';
import {
  cleanQuery,
  extractUrl,
  goalFor,
  normalizeStartUrl,
  parseCount,
  parseExtractionIntent,
  parseIntent,
  parseMediaIntent,
  planFromIntent,
  planWithRules,
} from '@webpilot/ai-core';

const FIXTURE_HOME = 'http://127.0.0.1:3001/test-site/';
const FIXTURE_SEARCH = 'http://127.0.0.1:3001/test-site/search';
const FIXTURE_PRODUCTS = 'http://127.0.0.1:3001/test-site/products';
const EXAMPLE = 'https://example.com';
const EXAMPLE_ARTICLE = 'https://example.com/article';

type StepType = Action['type'];

function stepTypes(plan: TaskPlan): StepType[] {
  return plan.steps.map((step) => step.type);
}

/** Comparable plan body — omits generated `createdAt`. */
function planBody(plan: TaskPlan): Omit<TaskPlan, 'createdAt'> {
  return {
    goal: plan.goal,
    steps: plan.steps,
    source: plan.source,
    warnings: plan.warnings,
  };
}

function expectIsoTimestamp(value: string): void {
  expect(Number.isNaN(Date.parse(value))).toBe(false);
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
}

function expectValidPlan(plan: TaskPlan): void {
  const parsed = TaskPlanSchema.safeParse(plan);
  expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(true);
  for (const [index, step] of plan.steps.entries()) {
    const action = ActionSchema.safeParse(step);
    expect(action.success, action.success ? undefined : `step ${index}: ${action.error.message}`).toBe(
      true,
    );
  }
  expect(plan.source).toBe('rule');
  expect(plan.warnings).toEqual([]);
  expectIsoTimestamp(plan.createdAt);
}

function expectNavigate(step: Action | undefined, url: string): void {
  expect(step).toMatchObject({ type: 'navigate', url });
}

function expectTypeSearch(step: Action | undefined, text: string): void {
  expect(step).toMatchObject({
    type: 'type',
    target: { strategy: 'testid', value: 'search-input' },
    text,
    submit: true,
  });
}

function expectExtract(
  step: Action | undefined,
  target: Extract<Action, { type: 'extract' }>['target'],
  query: string,
): void {
  expect(step).toMatchObject({ type: 'extract', target, query, limit: 200 });
}

function expectDownload(step: Action | undefined, count: number, query: string): void {
  expect(step).toMatchObject({ type: 'download', count, query });
}

describe('planWithRules — navigation', () => {
  it.each([
    {
      name: 'open example.com (parseIntent navigate_only still extracts text)',
      input: { prompt: `open ${EXAMPLE}` },
      url: EXAMPLE,
      query: `open ${EXAMPLE}`,
    },
    {
      name: 'visit a local fixture path (search — path has no extraction keyword)',
      input: { prompt: `visit ${FIXTURE_SEARCH}` },
      url: FIXTURE_SEARCH,
      query: `visit ${FIXTURE_SEARCH}`,
    },
    {
      name: 'go to an article URL with trailing punctuation stripped',
      input: { prompt: `go to ${EXAMPLE_ARTICLE}.` },
      url: EXAMPLE_ARTICLE,
      query: `go to ${EXAMPLE_ARTICLE}.`,
    },
    {
      name: 'bare example.com URL (no navigate verb)',
      input: { prompt: EXAMPLE },
      url: EXAMPLE,
      query: EXAMPLE,
    },
    {
      name: 'prompt URL wins over startUrl in the fallback path',
      input: { prompt: `navigate to ${EXAMPLE_ARTICLE}`, startUrl: FIXTURE_SEARCH },
      url: EXAMPLE_ARTICLE,
      query: `navigate to ${EXAMPLE_ARTICLE}`,
    },
    {
      name: 'startUrl is used when the prompt has no URL',
      input: { prompt: 'open the homepage', startUrl: FIXTURE_SEARCH },
      url: FIXTURE_SEARCH,
      query: 'open the homepage',
    },
    {
      name: 'invalid startUrl falls back to the local fixture',
      input: { prompt: 'visit the site', startUrl: 'not-a-url' },
      url: FIXTURE_HOME,
      query: 'visit the site',
    },
  ])('$name', ({ input, url, query }) => {
    const plan = planWithRules(input);
    expectValidPlan(plan);
    expect(plan.goal).toBe(input.prompt.trim());
    expect(stepTypes(plan)).toEqual(['navigate', 'extract']);
    expectNavigate(plan.steps[0], url);
    expectExtract(plan.steps[1], 'text', query);
  });
});

describe('planWithRules — extraction', () => {
  it.each([
    {
      name: 'extract product prices from example.com → tables',
      input: { prompt: `extract all product prices from ${EXAMPLE}` },
      url: EXAMPLE,
      target: 'tables' as const,
      query: 'all product prices',
    },
    {
      name: 'list links from a local products fixture → links',
      input: { prompt: `list all links from ${FIXTURE_PRODUCTS}` },
      url: FIXTURE_PRODUCTS,
      target: 'links' as const,
      query: 'all links',
    },
    {
      name: 'gather URLs from example.com → links',
      input: { prompt: `gather urls from ${EXAMPLE}` },
      url: EXAMPLE,
      target: 'links' as const,
      query: 'urls',
    },
    {
      name: 'find jobs from example.com → text (jobs is not a structured target)',
      input: { prompt: `find jobs from ${EXAMPLE}` },
      url: EXAMPLE,
      target: 'text' as const,
      query: 'jobs',
    },
    {
      name: 'show titles from a local article-less home fixture → text',
      input: { prompt: `show titles from ${FIXTURE_HOME}` },
      url: FIXTURE_HOME,
      target: 'text' as const,
      query: 'titles',
    },
    {
      name: 'keyword-only “products” with an explicit startUrl (no from-clause)',
      input: { prompt: 'products and prices', startUrl: FIXTURE_PRODUCTS },
      url: FIXTURE_PRODUCTS,
      target: 'tables' as const,
      query: 'products and prices',
    },
    {
      name: 'extract articles from example.com → text (articles is research-ish)',
      input: { prompt: `extract articles from ${EXAMPLE}` },
      url: EXAMPLE,
      target: 'text' as const,
      query: 'articles',
    },
    {
      name: 'get product prices from example.com (get is an extraction verb here)',
      input: { prompt: `get product prices from ${EXAMPLE}` },
      url: EXAMPLE,
      target: 'tables' as const,
      query: 'product prices',
    },
  ])('$name', ({ input, url, target, query }) => {
    const plan = planWithRules(input);
    expectValidPlan(plan);
    expect(plan.goal).toBe(input.prompt);
    expect(stepTypes(plan)).toEqual(['navigate', 'extract']);
    expectNavigate(plan.steps[0], url);
    expectExtract(plan.steps[1], target, query);
  });

  it('uses startUrl when an extraction prompt has no URL', () => {
    const prompt = 'extract the product table';
    const plan = planWithRules({ prompt, startUrl: FIXTURE_PRODUCTS });
    expectValidPlan(plan);
    expectNavigate(plan.steps[0], FIXTURE_PRODUCTS);
    expectExtract(plan.steps[1], 'tables', prompt);
  });
});

describe('planWithRules — download / media', () => {
  it.each([
    {
      name: 'download N sunset wallpapers (README-style)',
      input: { prompt: 'download 20 sunset wallpapers' },
      startUrl: FIXTURE_HOME,
      typed: 'sunset wallpapers',
      mediaQuery: 'sunset wallpapers image',
      count: 20,
      downloads: true,
    },
    {
      name: 'save five cat pictures (word number stays in the typed query)',
      input: { prompt: 'save five cat pictures', startUrl: FIXTURE_SEARCH },
      startUrl: FIXTURE_SEARCH,
      typed: 'five cat',
      mediaQuery: 'five cat image',
      count: 5,
      downloads: true,
    },
    {
      name: 'grab 3 icons (icons is kept in the cleaned query)',
      input: { prompt: 'grab 3 icons' },
      startUrl: FIXTURE_HOME,
      typed: 'icons',
      mediaQuery: 'icons image',
      count: 3,
      downloads: true,
    },
    {
      name: 'get photos of red maple trees (get is a download verb)',
      input: { prompt: 'get photos of red maple trees please' },
      startUrl: FIXTURE_HOME,
      typed: 'red maple trees',
      mediaQuery: 'red maple trees image',
      count: 10,
      downloads: true,
    },
    {
      name: 'word-count twenty photos (twenty stays in the typed query)',
      input: { prompt: 'download twenty forest photos' },
      startUrl: FIXTURE_HOME,
      typed: 'twenty forest',
      mediaQuery: 'twenty forest image',
      count: 20,
      downloads: true,
    },
    {
      name: 'default count is 10 when no number is present',
      input: { prompt: 'download sunset wallpapers' },
      startUrl: FIXTURE_HOME,
      typed: 'sunset wallpapers',
      mediaQuery: 'sunset wallpapers image',
      count: 10,
      downloads: true,
    },
  ])('$name', ({ input, startUrl, typed, mediaQuery, count, downloads }) => {
    const plan = planWithRules(input);
    expectValidPlan(plan);
    expect(plan.goal).toBe(input.prompt);
    expect(stepTypes(plan)).toEqual(
      downloads ? ['navigate', 'type', 'extract', 'download'] : ['navigate', 'type', 'extract'],
    );
    expectNavigate(plan.steps[0], startUrl);
    expectTypeSearch(plan.steps[1], typed);
    expectExtract(plan.steps[2], 'images', mediaQuery);
    if (downloads) expectDownload(plan.steps[3], count, mediaQuery);
  });

  it('find-without-download-verb browses (navigate + type + extract) only', () => {
    const plan = planWithRules({ prompt: 'find sunset pictures', startUrl: FIXTURE_SEARCH });
    expectValidPlan(plan);
    expect(stepTypes(plan)).toEqual(['navigate', 'type', 'extract']);
    expectNavigate(plan.steps[0], FIXTURE_SEARCH);
    expectTypeSearch(plan.steps[1], 'sunset');
    expectExtract(plan.steps[2], 'images', 'sunset image');
    expect(plan.steps.some((step) => step.type === 'download')).toBe(false);
  });

  it('clamps requested download count to ACTION_CAPS.downloadCount', () => {
    const plan = planWithRules({ prompt: 'download 999 images of lakes' });
    expectValidPlan(plan);
    expectDownload(plan.steps[3], ACTION_CAPS.downloadCount, 'lakes image');
  });

  it('clamps a parsed count of 0 up to 1', () => {
    const plan = planWithRules({ prompt: 'download 0 images of lakes' });
    expectValidPlan(plan);
    expectDownload(plan.steps[3], 1, 'lakes image');
  });
});

describe('planWithRules — empty and ambiguous input', () => {
  it.each([
    { name: 'empty string', prompt: '' },
    { name: 'whitespace only', prompt: '  \n\t  ' },
  ])('$name still emits navigate + extract, but the empty query fails the schema', ({ prompt }) => {
    const plan = planWithRules({ prompt });
    expect(plan.source).toBe('rule');
    expect(plan.goal).toBe('Complete the web task');
    expect(stepTypes(plan)).toEqual(['navigate', 'extract']);
    expectNavigate(plan.steps[0], FIXTURE_HOME);
    expectExtract(plan.steps[1], 'text', '');
    const parsed = TaskPlanSchema.safeParse(plan);
    expect(parsed.success).toBe(false);
    const extract = ActionSchema.safeParse(plan.steps[1]);
    expect(extract.success).toBe(false);
  });

  it('media keyword beats “extract … from URL” and ignores the prompt URL', () => {
    // Current routing: parseMediaIntent runs first. The example.com URL is not
    // used as the navigate target; the plan types into the fixture search box.
    // "extract" is not a cleanQuery stop word, so it becomes the typed query.
    const prompt = `extract images from ${EXAMPLE}`;
    const plan = planWithRules({ prompt });
    expectValidPlan(plan);
    expect(stepTypes(plan)).toEqual(['navigate', 'type', 'extract']);
    expectNavigate(plan.steps[0], FIXTURE_HOME);
    expectTypeSearch(plan.steps[1], 'extract');
    expectExtract(plan.steps[2], 'images', 'extract image');
    expect(plan.steps.some((step) => step.type === 'navigate' && step.url === EXAMPLE)).toBe(false);
  });

  it('“get images from URL” is a media+download plan, not extraction', () => {
    const plan = planWithRules({ prompt: `get images from ${EXAMPLE}` });
    expectValidPlan(plan);
    expect(stepTypes(plan)).toEqual(['navigate', 'type', 'extract', 'download']);
    expectNavigate(plan.steps[0], FIXTURE_HOME);
    expectDownload(plan.steps[3], 10, 'images image');
  });

  it('digits inside a local fixture host become the download count when no other number is given', () => {
    // parseCount sees 127 from 127.0.0.1 before any later port digits.
    const plan = planWithRules({ prompt: `download images from ${FIXTURE_HOME}` });
    expectValidPlan(plan);
    expectDownload(plan.steps[3], 127, 'images image');
  });

  it('an explicit count before a fixture URL wins over the IP digits', () => {
    const plan = planWithRules({ prompt: `download 5 images from ${FIXTURE_HOME}` });
    expectValidPlan(plan);
    expectDownload(plan.steps[3], 5, 'images image');
  });

  it('first 1–3 digit run wins: 1000 images is parsed as 100', () => {
    const plan = planWithRules({ prompt: 'download 1000 images of lakes' });
    expectValidPlan(plan);
    expectDownload(plan.steps[3], 100, 'lakes image');
  });

  it('first number wins when several counts appear', () => {
    const plan = planWithRules({ prompt: 'download 5 of 20 cat pictures' });
    expectValidPlan(plan);
    expectDownload(plan.steps[3], 5, 'cat image');
  });

  it('a navigate verb plus a /products fixture path is classified as table extraction', () => {
    const prompt = `visit ${FIXTURE_PRODUCTS}`;
    const plan = planWithRules({ prompt });
    expectValidPlan(plan);
    expect(parseExtractionIntent(prompt)?.url).toBe(FIXTURE_PRODUCTS);
    expect(stepTypes(plan)).toEqual(['navigate', 'extract']);
    expectNavigate(plan.steps[0], FIXTURE_PRODUCTS);
    expectExtract(plan.steps[1], 'tables', prompt);
  });

  it('research-style prompt without extract verbs falls back to navigate + text extract', () => {
    const prompt = `research news about climate from ${EXAMPLE}`;
    const plan = planWithRules({ prompt });
    expectValidPlan(plan);
    expect(parseIntent(prompt).kind).toBe('research');
    expect(stepTypes(plan)).toEqual(['navigate', 'extract']);
    expectNavigate(plan.steps[0], EXAMPLE);
    expectExtract(plan.steps[1], 'text', prompt);
  });

  it('a short general prompt with no URL uses the fixture and extracts the prompt as text', () => {
    const plan = planWithRules({ prompt: 'hello' });
    expectValidPlan(plan);
    expect(parseIntent('hello').kind).toBe('general');
    expectNavigate(plan.steps[0], FIXTURE_HOME);
    expectExtract(plan.steps[1], 'text', 'hello');
  });
});

describe('planWithRules — schema, determinism, public wrappers', () => {
  it('does not treat createdAt as a stable snapshot key', () => {
    const input = { prompt: `extract links from ${EXAMPLE}` };
    const first = planWithRules(input);
    const second = planWithRules(input);
    expectValidPlan(first);
    expectValidPlan(second);
    expect(planBody(first)).toEqual(planBody(second));
    expectIsoTimestamp(first.createdAt);
    expectIsoTimestamp(second.createdAt);
  });

  it('planFromIntent matches planWithRules for the same input (ignoring createdAt)', () => {
    const input = { prompt: 'download 8 cat pictures', startUrl: FIXTURE_SEARCH };
    expect(planBody(planFromIntent(input))).toEqual(planBody(planWithRules(input)));
  });

  it('trims the prompt before deriving the goal and before intent parsing', () => {
    const plan = planWithRules({ prompt: '  extract links from https://example.com  ' });
    expectValidPlan(plan);
    expect(plan.goal).toBe('extract links from https://example.com');
    expectExtract(plan.steps[1], 'links', 'links');
  });

  it('caps a long goal at 400 characters without snapshotting the whole plan', () => {
    const prompt = `extract titles from ${EXAMPLE} ${'x'.repeat(500)}`;
    const plan = planWithRules({ prompt });
    expectValidPlan(plan);
    expect(plan.goal).toBe(prompt.trim().slice(0, 400));
    expect(plan.goal).toHaveLength(400);
  });
});

describe('parseIntent — supported prompt categories', () => {
  it.each([
    { prompt: 'download 20 sunset wallpapers', kind: 'collect_images' as const, count: 20 },
    { prompt: 'find pictures of lakes', kind: 'collect_images' as const, count: 10 },
    { prompt: 'research news about climate', kind: 'research' as const, count: 10 },
    { prompt: 'read these papers please', kind: 'research' as const, count: 10 },
    { prompt: `extract all product prices from ${EXAMPLE}`, kind: 'extract_data' as const, count: 10 },
    { prompt: 'list jobs on the board', kind: 'extract_data' as const, count: 10 },
    { prompt: `open ${EXAMPLE}`, kind: 'navigate_only' as const, count: 1 },
    { prompt: `go to ${FIXTURE_HOME}`, kind: 'navigate_only' as const, count: 1 },
    { prompt: 'hello there', kind: 'general' as const, count: 10 },
  ])('$kind ← $prompt', ({ prompt, kind, count }) => {
    const intent = parseIntent(prompt);
    expect(intent.kind).toBe(kind);
    expect(intent.count).toBe(count);
    expect(intent.subject.length).toBeGreaterThan(0);
    expect(intent.subject.length).toBeLessThanOrEqual(120);
  });

  it('parseIntent count ignores word numbers (twenty → default 10); the rule planner does not', () => {
    expect(parseIntent('download twenty forest photos')).toMatchObject({
      kind: 'collect_images',
      count: 10,
    });
    expect(parseMediaIntent('download twenty forest photos')).toMatchObject({
      count: 20,
      download: true,
    });
  });
});

describe('rule-planner helpers used by the plans above', () => {
  it.each([
    { value: undefined, expected: FIXTURE_HOME },
    { value: '', expected: FIXTURE_HOME },
    { value: '  ', expected: FIXTURE_HOME },
    { value: FIXTURE_SEARCH, expected: FIXTURE_SEARCH },
    { value: `  ${EXAMPLE}  `, expected: EXAMPLE },
    { value: 'HTTP://Example.com/Foo', expected: 'HTTP://Example.com/Foo' },
    { value: 'ftp://example.com', expected: FIXTURE_HOME },
    { value: 'javascript:alert(1)', expected: FIXTURE_HOME },
    { value: '/test-site/', expected: FIXTURE_HOME },
  ])('normalizeStartUrl($value) → $expected', ({ value, expected }) => {
    expect(normalizeStartUrl(value)).toBe(expected);
  });

  it.each([
    { prompt: `see ${EXAMPLE} now`, expected: EXAMPLE },
    { prompt: `open ${EXAMPLE_ARTICLE}).`, expected: EXAMPLE_ARTICLE },
    { prompt: `visit ${FIXTURE_PRODUCTS}`, expected: FIXTURE_PRODUCTS },
    { prompt: 'no url here', expected: null },
    { prompt: 'ftp://example.com', expected: null },
  ])('extractUrl($prompt) → $expected', ({ prompt, expected }) => {
    expect(extractUrl(prompt)).toBe(expected);
  });

  it.each([
    { text: 'download 20 sunset wallpapers', expected: 20 },
    { text: 'save five cat pictures', expected: 5 },
    { text: 'no numbers', expected: null },
    { text: 'download 999 items', expected: 999 },
    { text: 'download 1000 images', expected: 100 },
  ])('parseCount($text) → $expected', ({ text, expected }) => {
    expect(parseCount(text)).toBe(expected);
  });

  it.each([
    { text: 'download 20 sunset wallpapers', expected: 'sunset wallpapers' },
    { text: 'find pictures of red maple trees please', expected: 'red maple trees' },
    { text: 'download images', expected: 'images' },
    { text: `get images from ${EXAMPLE}`, expected: 'images' },
    { text: `extract images from ${EXAMPLE}`, expected: 'extract' },
  ])('cleanQuery($text) → $expected', ({ text, expected }) => {
    expect(cleanQuery(text)).toBe(expected);
  });

  it.each([
    { prompt: '  hello  ', expected: 'hello' },
    { prompt: '', expected: 'Complete the web task' },
    { prompt: '   ', expected: 'Complete the web task' },
  ])('goalFor($prompt) → $expected', ({ prompt, expected }) => {
    expect(goalFor(prompt)).toBe(expected);
  });

  it('parseMediaIntent is null when no media keyword is present', () => {
    expect(parseMediaIntent(`extract prices from ${EXAMPLE}`)).toBeNull();
  });

  it('parseExtractionIntent reads the from-clause query and prompt URL', () => {
    expect(parseExtractionIntent(`list all links from ${EXAMPLE}`)).toEqual({
      query: 'all links',
      url: EXAMPLE,
    });
  });
});
