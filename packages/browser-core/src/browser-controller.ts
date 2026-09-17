import { statSync } from 'node:fs';
import type { Page } from 'playwright';
import {
  toWebPilotError,
  WebPilotError,
  type ClickAction,
  type ExtractAction,
  type LocatorSpec,
  type NavigateAction,
  type PressAction,
  type ScrollAction,
  type TypeAction,
  type WaitAction,
} from '@webpilot/schemas';
import { config, loggerFor, safeJoin, sleep } from '@webpilot/shared';
import { Extractor } from '@webpilot/extraction-core';
import { sanitizeDownloadFilename } from '@webpilot/download-core';
import type { DownloadRequest, DownloadResult } from '@webpilot/download-core';
import type { BrowserManager } from './browser-manager';
import { describeSpec, resolveLocator } from './locator';

const log = loggerFor('browser:controller');

/** What every interaction reports back to the agent/observer. */
export interface OperationResult {
  summary: string;
  detail?: string;
  data?: Record<string, unknown>;
}

export interface BrowserControllerOptions {
  manager: BrowserManager;
  actionTimeoutMs?: number;
  /** Injected so browser-core does not own download policy. */
  downloader?: { download(request: DownloadRequest): Promise<DownloadResult> };
  /** Page URL prefix treated as "the local test site" (used in tests). */
  signal?: AbortSignal;
}

/**
 * Turns validated actions into Playwright operations.
 *
 * Contains **no AI logic** and no decision making: it either performs the action
 * or throws a typed `WebPilotError` the replanner can reason about.
 */
export class BrowserController {
  private readonly manager: BrowserManager;
  private readonly actionTimeoutMs: number;
  private readonly downloader?: BrowserControllerOptions['downloader'];

  constructor(options: BrowserControllerOptions) {
    this.manager = options.manager;
    this.actionTimeoutMs = options.actionTimeoutMs ?? config.browser.actionTimeoutMs;
    this.downloader = options.downloader;
  }

  get browser(): BrowserManager {
    return this.manager;
  }

  async page(): Promise<Page> {
    return this.manager.currentPage();
  }

  private async run<T>(label: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const wp = toWebPilotError(error, 'ACTION_TIMEOUT');
      if (wp.code === 'SELECTOR_NOT_FOUND') throw wp;
      throw new WebPilotError(
        wp.code === 'UNKNOWN' ? 'ACTION_TIMEOUT' : wp.code,
        `${label} failed: ${wp.message}`,
        { recoverable: true, cause: error, details: wp.details },
      );
    }
  }

  async navigate(action: NavigateAction): Promise<OperationResult> {
    const result = await this.manager.navigate(action.url, {
      ...(action.waitUntil ? { waitUntil: action.waitUntil } : {}),
    });
    log.info('navigation completed', { url: result.url, status: result.status });
    return {
      summary: `opened ${result.url}`,
      detail: result.title,
      data: { url: result.url, title: result.title, status: result.status },
    };
  }

  async click(action: ClickAction): Promise<OperationResult> {
    const page = await this.manager.currentPage();
    const resolved = await resolveLocator(page, action.target, { timeoutMs: this.actionTimeoutMs });
    await this.run(`click ${describeSpec(resolved.spec)}`, () =>
      resolved.locator.click({
        button: action.button ?? 'left',
        clickCount: action.clickCount ?? 1,
        timeout: this.actionTimeoutMs,
      }),
    );
    return {
      summary: `clicked ${describeSpec(resolved.spec)}`,
      detail: resolved.matched > 1 ? `${resolved.matched} matches, used the first` : undefined,
      data: {
        url: page.url(),
        strategy: resolved.strategy,
        matched: resolved.matched,
        visible: resolved.visible,
      },
    };
  }

  async type(action: TypeAction): Promise<OperationResult> {
    const page = await this.manager.currentPage();
    const resolved = await resolveLocator(page, action.target, { timeoutMs: this.actionTimeoutMs });
    const clear = action.clear ?? true;

    await this.run(`type into ${describeSpec(resolved.spec)}`, async () => {
      if (clear) await resolved.locator.fill('');
      if (action.submit) {
        // mimic human typing so autocomplete/suggestion widgets react
        await resolved.locator.pressSequentially(action.text, { delay: 15 });
        await resolved.locator.press('Enter', { timeout: this.actionTimeoutMs });
        if (page.url().startsWith('http')) {
          await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
        }
      } else {
        await resolved.locator.fill(action.text, { timeout: this.actionTimeoutMs });
      }
    });

    return {
      summary: `typed ${action.text.length} characters into ${describeSpec(resolved.spec)}`,
      detail: action.submit ? 'submitted the field' : undefined,
      data: { url: page.url(), strategy: resolved.strategy, matched: resolved.matched },
    };
  }

  async press(action: PressAction): Promise<OperationResult> {
    const page = await this.manager.currentPage();
    if (action.target) {
      const resolved = await resolveLocator(page, action.target, { timeoutMs: this.actionTimeoutMs });
      await this.run(`press ${action.key}`, () =>
        resolved.locator.press(action.key, { timeout: this.actionTimeoutMs }),
      );
      return { summary: `pressed ${action.key} on ${describeSpec(resolved.spec)}` };
    }
    await this.run(`press ${action.key}`, () => page.keyboard.press(action.key));
    return { summary: `pressed ${action.key}` };
  }

  async scroll(action: ScrollAction): Promise<OperationResult> {
    const page = await this.manager.currentPage();
    const amount = action.amount ?? 700;

    if (action.target) {
      const resolved = await resolveLocator(page, action.target, { timeoutMs: this.actionTimeoutMs });
      await this.run(`scroll to ${describeSpec(resolved.spec)}`, () =>
        resolved.locator.scrollIntoViewIfNeeded({ timeout: this.actionTimeoutMs }),
      );
      return { summary: `scrolled to ${describeSpec(resolved.spec)}` };
    }

    await this.run(`scroll ${action.direction}`, async () => {
      switch (action.direction) {
        case 'top':
          await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" })');
          break;
        case 'bottom':
          await page.evaluate('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
          break;
        case 'up':
          await page.mouse.wheel(0, -Math.abs(amount));
          break;
        case 'down':
        default:
          await page.mouse.wheel(0, Math.abs(amount));
          break;
      }
      await sleep(250); // let lazy loaded content settle
    });

    return {
      summary: `scrolled ${action.direction}`,
      data: { url: page.url(), amount },
    };
  }

  /** Waits for a duration or for an element to become visible. */
  async wait(action: WaitAction): Promise<OperationResult> {
    if (action.forSelector) {
      const page = await this.manager.currentPage();
      const resolved = await resolveLocator(page, action.forSelector, {
        timeoutMs: Math.max(this.actionTimeoutMs, 5_000),
      });
      return { summary: `waited for ${describeSpec(resolved.spec)}` };
    }
    const ms = action.ms ?? 1_000;
    await sleep(ms);
    return { summary: `waited ${ms}ms` };
  }

  async extract(action: ExtractAction): Promise<OperationResult> {
    const page = await this.manager.currentPage();
    const extractor = new Extractor(page);
    const data = await extractor.extract(action.target, {
      ...(action.selector ? { selector: action.selector } : {}),
      ...(action.limit ? { limit: action.limit } : {}),
      ...(action.query ? { query: action.query } : {}),
      sourcePage: page.url(),
    });
    const count = Array.isArray(data) ? data.length : 1;
    return {
      summary: `extracted ${count} ${action.target} item(s)`,
      data: { url: page.url(), target: action.target, count, items: data },
    };
  }

  /** Compact observation of the current page. */
  async observe() {
    return this.manager.getPageState();
  }

  async currentUrl(): Promise<string> {
    const page = await this.manager.currentPage();
    return page.url();
  }

  async screenshot(options: { directory?: string; name?: string; fullPage?: boolean; taskId?: string } = {}) {
    return this.manager.screenshot(options);
  }

  /**
   * Downloads a URL over HTTP (no browser session). Policy — allow-lists, size
   * caps, manifests — lives in `@webpilot/download-core`; the controller only
   * forwards the request.
   */
  async download(request: DownloadRequest): Promise<DownloadResult> {
    if (!this.downloader) {
      throw new WebPilotError('CONFIG_INVALID', 'No download handler is configured for this run', {
        recoverable: false,
      });
    }
    return this.downloader.download(request);
  }

  /**
   * Downloads a resource that requires the browser's own session (cookies,
   * auth headers, JS generated URLs) by clicking an element and catching
   * Playwright's `download` event.
   */
  async downloadViaClick(
    spec: LocatorSpec,
    options: { directory: string; filename?: string },
  ): Promise<{ path: string; suggestedFilename: string; bytes: number }> {
    const page = await this.manager.currentPage();
    const resolved = await resolveLocator(page, spec, { timeoutMs: this.actionTimeoutMs });

    const downloadPromise = page.waitForEvent('download', { timeout: Math.max(15_000, this.actionTimeoutMs) });
    await resolved.locator.click({ timeout: this.actionTimeoutMs });
    const download = await downloadPromise;

    const suggested = download.suggestedFilename();
    const filename = sanitizeDownloadFilename(options.filename ?? suggested, 'download');
    const target = safeJoin(options.directory, filename);
    await download.saveAs(target);
    log.info('browser download saved', { filename, path: target });
    return { path: target, suggestedFilename: suggested, bytes: statSync(target).size };
  }
}