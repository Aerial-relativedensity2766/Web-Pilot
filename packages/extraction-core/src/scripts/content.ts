import type {
  MetadataScanResult,
  PageStateScanResult,
  TableScanResult,
  TextScanResult,
} from '../types';

interface TextScanInput {
  selector: string | null;
  limit: number;
  minLength: number;
}

interface PageStateScanInput {
  maxInteractive: number;
}

/** Runs inside the page: meaningful text blocks (headings, paragraphs, list items). */
export function scanTextInPage(input: TextScanInput): TextScanResult[] {
  const results: TextScanResult[] = [];
  const seen: Record<string, boolean> = {};

  const root: ParentNode = input.selector
    ? (document.querySelector(input.selector) ?? document)
    : document;

  const elements = Array.from(root.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, figcaption'));

  for (const element of elements) {
    if (results.length >= input.limit) break;
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < input.minLength) continue;
    const key = text.slice(0, 120);
    if (seen[key]) continue;
    seen[key] = true;
    results.push({ text: text.slice(0, 1_000), tag: element.tagName.toLowerCase() });
  }

  return results;
}

/** Runs inside the page: title, meta description, canonical link, OpenGraph, JSON-LD. */
export function scanMetadataInPage(): MetadataScanResult {
  const meta = (name: string, attribute = 'name'): string => {
    const element = document.querySelector(`meta[${attribute}="${name}"]`);
    return (element?.getAttribute('content') ?? '').trim().slice(0, 500);
  };

  const jsonLd: unknown[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    if (jsonLd.length >= 20) break;
    const raw = script.textContent ?? '';
    if (!raw.trim()) continue;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      // ignore malformed structured data instead of failing the extraction
    }
  }

  return {
    title: (document.title ?? '').trim(),
    description: meta('description'),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    lang: document.documentElement?.getAttribute('lang') ?? '',
    ogTitle: meta('og:title', 'property'),
    ogImage: meta('og:image', 'property'),
    jsonLd,
  };
}

/** Runs inside the page: HTML tables with headers and rows. */
export function scanTablesInPage(input: { selector: string | null; limit: number }): TableScanResult[] {
  const results: TableScanResult[] = [];
  const root: ParentNode = input.selector
    ? (document.querySelector(input.selector) ?? document)
    : document;

  for (const table of Array.from(root.querySelectorAll('table'))) {
    if (results.length >= input.limit) break;
    const caption = (table.querySelector('caption')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    );
    const rows: string[][] = [];
    for (const row of Array.from(table.querySelectorAll('tbody tr, tr'))) {
      if (rows.length >= 500) break;
      const cells = Array.from(row.querySelectorAll('td')).map((cell) =>
        (cell.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      );
      if (cells.length > 0) rows.push(cells);
    }
    if (headers.length === 0 && rows.length === 0) continue;
    results.push({ caption, headers, rows });
  }

  return results;
}

/**
 * Runs inside the page: the compact observation model sent to the agent and
 * (optionally) into the AI context. Counts plus a short list of controls — never
 * the raw HTML.
 */
export function scanPageStateInPage(input: PageStateScanInput): PageStateScanResult {
  const interactive: PageStateScanResult['interactive'] = [];

  const labelOf = (element: Element): string => {
    const aria = element.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder;
    const title = element.getAttribute('title');
    return (title ?? '').trim();
  };

  const add = (kind: string, element: Element) => {
    if (interactive.length >= input.maxInteractive) return;
    const label = labelOf(element).slice(0, 160);
    if (!label) return;
    interactive.push({
      kind,
      label,
      role: element.getAttribute('role') ?? '',
      testId: element.getAttribute('data-testid') ?? '',
      id: element.id ?? '',
    });
  };

  for (const element of Array.from(document.querySelectorAll('a[href]'))) add('link', element);
  for (const element of Array.from(document.querySelectorAll('button, [role="button"]'))) {
    add('button', element);
  }
  for (const element of Array.from(document.querySelectorAll('input:not([type="hidden"])'))) {
    add('input', element);
  }
  for (const element of Array.from(document.querySelectorAll('select'))) add('select', element);
  for (const element of Array.from(document.querySelectorAll('textarea'))) add('textarea', element);

  const bodyText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();

  return {
    url: location.href,
    title: (document.title ?? '').trim(),
    links: document.querySelectorAll('a[href]').length,
    images: document.querySelectorAll('img').length,
    buttons: document.querySelectorAll('button, [role="button"], input[type="submit"]').length,
    inputs: document.querySelectorAll('input:not([type="hidden"]), select, textarea').length,
    forms: document.querySelectorAll('form').length,
    headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
    textLength: bodyText.length,
    interactive,
  };
}