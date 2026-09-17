import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import type { LocatorSpec } from '@webpilot/schemas';
import { ensureTestSiteRunning, siteUrl, withBrowser } from './support';

/**
 * Integration: agent → browser.
 * Runs against the local fixture site with a real Chromium instance.
 */

const searchInput: LocatorSpec = { strategy: 'testid', value: 'search-input' };
const searchButton: LocatorSpec = { strategy: 'testid', value: 'search-button' };

beforeAll(async () => {
  await ensureTestSiteRunning();
});

describe('BrowserManager', () => {
  it('launches, navigates and observes page state', async () => {
    await withBrowser(async ({ manager }) => {
      expect(manager.status).toBe('ready');
      const result = await manager.navigate(siteUrl());
      expect(result.title).toContain('WebPilot Fixture Site');

      const state = await manager.getPageState();
      expect(state.url).toContain('/test-site/');
      expect(state.images).toBeGreaterThanOrEqual(3);
      expect(state.buttons).toBeGreaterThanOrEqual(4);
      expect(state.inputs).toBeGreaterThanOrEqual(1);
      expect(state.interactive.length).toBeGreaterThan(0);
      expect(state.interactive.some((item) => item.testId === 'search-input')).toBe(true);
    });
  });

  it('takes a screenshot into the configured directory', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl());
      const shot = await manager.screenshot({ taskId: 'task-9999', name: 'home' });
      expect(shot.bytes).toBeGreaterThan(1_000);
      expect(shot.path).toContain('task-9999');
    });
  });

  it('reports browser info and closes cleanly', async () => {
    const manager = new (await import('@webpilot/browser-core')).BrowserManager({ headless: true });
    await manager.launch();
    const info = await manager.browserInfo();
    expect(info.status).toBe('ready');
    expect(info.engine).toBe('chromium');
    expect(info.version).toBeTruthy();
    await manager.close();
    expect(manager.status).toBe('stopped');
  });
});

describe('BrowserController', () => {
  it('searches the fixture site by typing and clicking', async () => {
    await withBrowser(async ({ controller }) => {
      await controller.navigate({ type: 'navigate', url: siteUrl() });
      const typed = await controller.type({ type: 'type', target: searchInput, text: 'tree' });
      expect(typed.summary).toContain('typed');

      const clicked = await controller.click({
        type: 'click',
        target: searchButton,
      });
      expect(clicked.summary).toContain('clicked');

      const url = await controller.currentUrl();
      expect(url).toContain('/search');
      expect(url).toContain('q=tree');

      const state = await controller.observe();
      expect(state.images).toBeGreaterThanOrEqual(12);
    });
  });

  it('submits the search form when `submit` is set', async () => {
    await withBrowser(async ({ controller }) => {
      await controller.navigate({ type: 'navigate', url: siteUrl() });
      await controller.type({
        type: 'type',
        target: searchInput,
        text: 'tree',
        submit: true,
      });
      expect(await controller.currentUrl()).toContain('q=tree');
    });
  });

  it('falls back to other locator strategies when the css selector is wrong', async () => {
    await withBrowser(async ({ controller }) => {
      await controller.navigate({ type: 'navigate', url: siteUrl() });
      // deliberately wrong: no such id, but the accessible name "Search" exists
      const result = await controller.click({
        type: 'click',
        target: { strategy: 'css', value: '#does-not-exist', name: 'Search' },
      });
      expect(result.data?.strategy).toBeDefined();
    });
  });

  it('scrolls, waits and reports a missing selector as SELECTOR_NOT_FOUND', async () => {
    await withBrowser(async ({ controller }) => {
      await controller.navigate({ type: 'navigate', url: siteUrl() });
      await controller.scroll({ type: 'scroll', direction: 'bottom' });
      await controller.wait({ type: 'wait', ms: 50 });

      await expect(
        controller.click({
          type: 'click',
          target: { strategy: 'css', value: '#definitely-not-here-1234567890' },
        }),
      ).rejects.toThrow(/Could not find an element/);
    });
  });

  it('respects the tab limit', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl());
      await manager.newPage();
      await manager.newPage();
      expect(manager.pageCount).toBeLessThanOrEqual(2);
    });
  });
});

afterAll(() => {
  // nothing global to tear down: each test closes its own browser
});
