import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from 'playwright';
import { BrowserStatusSchema, toWebPilotError, WebPilotError, type BrowserStatus, type PageState } from '@webpilot/schemas';
import { config, ensureDir, loggerFor, safeJoin, safeSegment, nowIso } from '@webpilot/shared';
import { Extractor } from '@webpilot/extraction-core';

const log = loggerFor('browser');

export interface BrowserManagerOptions {
  engine?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
  maxTabs?: number;
  contextName?: string;
  screenshotsDir?: string;
  onStatusChange?: (status: BrowserStatus, detail?: Record<string, unknown>) => void;
}

export interface NavigationResult {
  url: string;
  title: string;
  status: number | null;
}

export interface ScreenshotResult {
  path: string;
  filename: string;
  bytes: number;
  takenAt: string;
}

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };

/**
 * Owns the Playwright lifecycle and the isolated browser context.
 *
 * The context is created fresh, in-memory and never pointed at the user's
 * personal browser profile, so WebPilot cannot accidentally reach Gmail,
 * banking or any other logged-in session the user has open.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly pages: Page[] = [];
  private currentPageRef: Page | null = null;
  private statusValue: BrowserStatus = 'stopped';
  private lastError: string | null = null;
  private launching: Promise<void> | null = null;

  constructor(private readonly options: BrowserManagerOptions = {}) {}

  get status(): BrowserStatus {
    return this.statusValue;
  }

  get contextName(): string {
    return this.options.contextName ?? config.browser.contextName;
  }

  get error(): string | null {
    return this.lastError;
  }

  private setStatus(status: BrowserStatus, detail?: Record<string, unknown>): void {
    const parsed = BrowserStatusSchema.safeParse(status);
    this.statusValue = parsed.success ? parsed.data : 'error';
    log.debug('browser status changed', { status: this.statusValue, ...detail });
    this.options.onStatusChange?.(this.statusValue, detail);
  }

  get isRunning(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  /** Launches the browser and the isolated context (idempotent). */
  async launch(): Promise<void> {
    if (this.isRunning && this.context) return;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      this.setStatus('launching');
      const engineName = this.options.engine ?? config.browser.engine;
      const engine = ENGINES[engineName];
      if (!engine) {
        this.setStatus('error');
        throw new WebPilotError('CONFIG_INVALID', `Unsupported browser engine: ${engineName}`, {
          recoverable: false,
        });
      }

      try {
        this.browser = await engine.launch({
          headless: this.options.headless ?? config.browser.headless,
          args: engineName === 'chromium' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
        });
      } catch (error) {
        this.setStatus('error');
        const message = error instanceof Error ? error.message : String(error);
        throw new WebPilotError('BROWSER_LAUNCH_FAILED', `Could not launch ${engineName}: ${message}`, {
          recoverable: false,
          cause: error,
          details: { hint: 'Run `bunx playwright install chromium` to install the browser.' },
        });
      }

      this.browser.on('disconnected', () => {
        this.browser = null;
        this.context = null;
        this.pages.length = 0;
        this.currentPageRef = null;
        this.setStatus('stopped', { reason: 'disconnected' });
      });

      this.context = await this.browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1366, height: 900 },
        locale: 'en-US',
        bypassCSP: false,
        serviceWorkers: 'allow',
      });
      this.context.setDefaultTimeout(this.options.actionTimeoutMs ?? config.browser.actionTimeoutMs);
      this.context.setDefaultNavigationTimeout(
        this.options.navigationTimeoutMs ?? config.browser.navigationTimeoutMs,
      );
      this.setStatus('ready', { engine: engineName, context: this.contextName });
      log.info('browser launched', { engine: engineName, context: this.contextName });
    })();

    try {
      await this.launching;
    } finally {
      this.launching = null;
    }
  }

  private attachPageHandlers(page: Page): void {
    // Never let an unexpected dialog block the agent, and never auto-accept one
    // either: dismissing is the safe default.
    page.on('dialog', (dialog) => {
      log.warn('dialog dismissed', { type: dialog.type(), message: dialog.message().slice(0, 200) });
      void dialog.dismiss().catch(() => undefined);
    });
    page.on('pageerror', (error) => {
      log.debug('page error', { message: error.message.slice(0, 300) });
    });
    page.on('crash', () => {
      log.error('page crashed', { page: page.url() });
    });
    page.on('close', () => {
      const index = this.pages.indexOf(page);
      if (index >= 0) this.pages.splice(index, 1);
      if (this.currentPageRef === page) this.currentPageRef = this.pages.at(-1) ?? null;
    });
  }

  /** Creates (or reuses) the active page, respecting `maxTabs`. */
  async newPage(): Promise<Page> {
    await this.launch();
    const context = this.context;
    if (!context) {
      throw new WebPilotError('BROWSER_NOT_READY', 'Browser context is not available', {
        recoverable: true,
      });
    }

    const maxTabs = this.options.maxTabs ?? config.browser.maxTabs;
    while (this.pages.length >= maxTabs) {
      const victim = this.pages.find((page) => page !== this.currentPageRef && !page.isClosed());
      if (!victim) break;
      log.debug('closing oldest tab to respect the tab limit', { maxTabs });
      await victim.close().catch(() => undefined);
      const index = this.pages.indexOf(victim);
      if (index >= 0) this.pages.splice(index, 1);
    }

    const page = await context.newPage();
    this.attachPageHandlers(page);
    this.pages.push(page);
    this.currentPageRef = page;
    return page;
  }

  /** The page actions run against. */
  async currentPage(): Promise<Page> {
    if (this.currentPageRef && !this.currentPageRef.isClosed()) return this.currentPageRef;
    const open = this.pages.find((page) => !page.isClosed());
    if (open) {
      this.currentPageRef = open;
      return open;
    }
    return this.newPage();
  }

  async setCurrentPage(page: Page): Promise<void> {
    this.currentPageRef = page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Navigates the current page and reports the resulting state. */
  async navigate(
    url: string,
    options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' } = {},
  ): Promise<NavigationResult> {
    const page = await this.currentPage();
    const timeout = this.options.navigationTimeoutMs ?? config.browser.navigationTimeoutMs;
    try {
      const response = await page.goto(url, {
        waitUntil: options.waitUntil ?? 'domcontentloaded',
        timeout,
      });
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
      return {
        url: page.url(),
        title: await page.title().catch(() => ''),
        status: response?.status() ?? null,
      };
    } catch (error) {
      const wpError = toWebPilotError(error, 'NAVIGATION_FAILED');
      const recoverable = !/net::ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED|INVALID_URL)/.test(
        wpError.message,
      );
      throw new WebPilotError('NAVIGATION_FAILED', `Could not open ${url}: ${wpError.message}`, {
        recoverable,
        cause: error,
        details: { url },
      });
    }
  }

  /** Compact observation of the current page (counts + interactive controls). */
  async getPageState(): Promise<PageState> {
    const page = await this.currentPage();
    return new Extractor(page).observe();
  }

  async screenshot(
    options: { directory?: string; name?: string; fullPage?: boolean; taskId?: string } = {},
  ): Promise<ScreenshotResult> {
    const page = await this.currentPage();
    const baseDir = options.directory
      ? ensureDir(options.directory)
      : ensureDir(safeJoin(config.screenshotsDir, safeSegment(options.taskId ?? 'shared', 'shared')));
    const filename = `${safeSegment(options.name ?? `shot-${Date.now()}`, 'shot')}.png`;
    const target = safeJoin(baseDir, filename);
    await page.screenshot({ path: target, fullPage: options.fullPage ?? false });
    const { statSync } = await import('node:fs');
    return {
      path: target,
      filename,
      bytes: statSync(target).size,
      takenAt: nowIso(),
    };
  }

  async browserInfo(): Promise<{
    engine: string;
    version: string | null;
    headless: boolean;
    status: BrowserStatus;
    pages: number;
    context: string;
    error: string | null;
  }> {
    return {
      engine: this.options.engine ?? config.browser.engine,
      version: this.browser?.version() ?? null,
      headless: this.options.headless ?? config.browser.headless,
      status: this.statusValue,
      pages: this.pages.length,
      context: this.contextName,
      error: this.lastError,
    };
  }

  /** Closes every page, the context and the browser. */
  async close(): Promise<void> {
    this.setStatus('closing');
    try {
      await this.context?.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
    } finally {
      this.context = null;
      this.browser = null;
      this.pages.length = 0;
      this.currentPageRef = null;
      this.setStatus('stopped');
      log.info('browser closed');
    }
  }
}
