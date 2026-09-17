import { BrowserController, BrowserManager } from '@webpilot/browser-core';
import type { BrowserControllerOptions } from '@webpilot/browser-core';

export const TEST_SITE_URL = process.env.TEST_SITE_URL ?? 'http://127.0.0.1:3001/test-site';

export function siteUrl(path = ''): string {
  if (!path) return `${TEST_SITE_URL}/`;
  return `${TEST_SITE_URL}/${path.replace(/^\//, '')}`;
}

export interface BrowserHarness {
  manager: BrowserManager;
  controller: BrowserController;
}

/**
 * Launches one isolated Chromium for a test and guarantees teardown.
 * Downloads fall back to a caller supplied handler when needed.
 */
export async function withBrowser<T>(
  run: (harness: BrowserHarness) => Promise<T>,
  options: { controllerOptions?: Partial<BrowserControllerOptions> } = {},
): Promise<T> {
  const manager = new BrowserManager({ headless: true, maxTabs: 2 });
  const controller = new BrowserController({
    manager,
    actionTimeoutMs: 10_000,
    ...options.controllerOptions,
  });
  try {
    await manager.launch();
    return await run({ manager, controller });
  } finally {
    await manager.close();
  }
}

/** Waits until the fixture site answers, so failures are obvious. */
export async function ensureTestSiteRunning(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${TEST_SITE_URL.replace(/\/$/, '')}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `The fixture site at ${TEST_SITE_URL} is not reachable. Start it with: bun run apps/test-site/src/server.ts (${String(lastError)})`,
  );
}