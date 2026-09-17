import type { ButtonScanResult, InputScanResult, LinkScanResult } from '../types';

interface LinkScanInput {
  selector: string | null;
  limit: number;
  sameSiteOnly: boolean;
}

interface InteractiveScanInput {
  selector: string | null;
  limit: number;
}

/**
 * Runs inside the page: collects anchor links with visible text.
 * Self contained by design (serialized by Playwright).
 */
export function scanLinksInPage(input: LinkScanInput): LinkScanResult[] {
  const results: LinkScanResult[] = [];
  const seen: Record<string, boolean> = {};

  const root: ParentNode = input.selector
    ? (document.querySelector(input.selector) ?? document)
    : document;

  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    if (results.length >= input.limit) break;
    const href = anchor.getAttribute('href');
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, document.baseURI);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    if (input.sameSiteOnly && url.hostname !== location.hostname) continue;
    const absolute = url.toString();
    if (seen[absolute]) continue;
    const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    seen[absolute] = true;
    results.push({
      url: absolute,
      text,
      rel: (anchor.getAttribute('rel') ?? '').slice(0, 60),
    });
  }

  return results;
}

/** Runs inside the page: buttons of every flavour (native, role, input based). */
export function scanButtonsInPage(input: InteractiveScanInput): ButtonScanResult[] {
  const results: ButtonScanResult[] = [];
  const seen: Record<string, boolean> = {};

  const root: ParentNode = input.selector
    ? (document.querySelector(input.selector) ?? document)
    : document;

  const labelOf = (element: Element): string => {
    const aria = element.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, 160);
    const value = element.getAttribute('value');
    if (value && value.trim()) return value.trim().slice(0, 160);
    const title = element.getAttribute('title');
    if (title && title.trim()) return title.trim().slice(0, 160);
    return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  };

  const selectors = [
    'button',
    '[role="button"]',
    'input[type="submit"]',
    'input[type="button"]',
    'input[type="reset"]',
    '[data-testid][role="button"]',
  ];

  for (const selector of selectors) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (results.length >= input.limit) break;
      const label = labelOf(element);
      if (!label) continue;
      const testId = element.getAttribute('data-testid') ?? '';
      const id = element.id ?? '';
      const key = `${label}|${testId}|${id}`;
      if (seen[key]) continue;
      seen[key] = true;
      results.push({
        label,
        role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
        testId,
        id,
      });
    }
  }

  return results;
}

/** Runs inside the page: form controls with their best human readable label. */
export function scanInputsInPage(input: InteractiveScanInput): InputScanResult[] {
  const results: InputScanResult[] = [];
  const seen: Record<string, boolean> = {};

  const root: ParentNode = input.selector
    ? (document.querySelector(input.selector) ?? document)
    : document;

  const labelOf = (element: Element): string => {
    const aria = element.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, 160);
    const id = element.getAttribute('id');
    if (id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      const text = (explicit?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 160);
    }
    const wrapping = element.closest('label');
    const text = (wrapping?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 160);
  };

  const controls = Array.from(
    root.querySelectorAll('input:not([type="hidden"]), select, textarea'),
  );

  for (const element of controls) {
    if (results.length >= input.limit) break;
    const type = (element.getAttribute('type') ?? element.tagName.toLowerCase()).toLowerCase();
    const name = element.getAttribute('name') ?? '';
    const placeholder = element.getAttribute('placeholder') ?? '';
    const testId = element.getAttribute('data-testid') ?? '';
    const id = element.id ?? '';
    const label = labelOf(element);
    const key = `${name}|${testId}|${id}|${type}`;
    if (seen[key]) continue;
    seen[key] = true;
    results.push({
      name: name.slice(0, 80),
      type: type.slice(0, 40),
      label,
      placeholder: placeholder.slice(0, 160),
      testId,
      id,
    });
  }

  return results;
}