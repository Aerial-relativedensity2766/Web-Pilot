import type { Page } from 'playwright';
import {
  ExtractedButtonSchema,
  ExtractedImageSchema,
  ExtractedInputSchema,
  ExtractedLinkSchema,
  ExtractedTableSchema,
  ExtractedTextBlockSchema,
  PageStateSchema,
  type ExtractTarget,
  type ExtractedButton,
  type ExtractedImage,
  type ExtractedInput,
  type ExtractedLink,
  type ExtractedTable,
  type ExtractedTextBlock,
  type PageMetadata,
  type PageState,
} from '@webpilot/schemas';
import { isLowValueLabel, isTrackingPixelLike, loggerFor, sleep, uniqueBy } from '@webpilot/shared';
import {
  DEFAULT_EXTRACT_LIMIT,
  DEFAULT_MIN_IMAGE_SIZE,
  type ExtractOptions,
  type ImageExtractOptions,
  type LinkExtractOptions,
  type TextExtractOptions,
} from './types';
import { countPendingImagesInPage, scanImagesInPage } from './scripts/images';
import { scanButtonsInPage, scanInputsInPage, scanLinksInPage } from './scripts/interactive';
import {
  scanMetadataInPage,
  scanPageStateInPage,
  scanTablesInPage,
  scanTextInPage,
} from './scripts/content';

const log = loggerFor('extraction');

/** Supplementary output of `extractStructuredData()`. */
export interface StructuredDataResult {
  url: string;
  jsonLd: unknown[];
  tables: ExtractedTable[];
  openGraph: { title?: string; image?: string };
}

/**
 * Deterministic, rule based DOM extraction.
 *
 * Every method is defensive: a missing element, a cross-origin frame or a
 * malformed JSON-LD block degrades to an empty result instead of failing the
 * task. No AI is involved here — that is deliberate (see "AI should decide,
 * code should execute").
 */
export class Extractor {
  constructor(private readonly page: Page) {}

  private async sourceUrl(fallback?: string): Promise<string> {
    return fallback ?? this.page.url();
  }

  /** Images with real dimensions, tracking pixels removed, best candidates first. */
  async extractImages(options: ImageExtractOptions = {}): Promise<ExtractedImage[]> {
    const sourcePage = await this.sourceUrl(options.sourcePage);
    const scanOptions = {
      selector: options.selector ?? null,
      limit: options.limit ?? DEFAULT_EXTRACT_LIMIT,
      minWidth: options.minWidth ?? (options.includeSmall ? 0 : DEFAULT_MIN_IMAGE_SIZE),
      minHeight: options.minHeight ?? (options.includeSmall ? 0 : DEFAULT_MIN_IMAGE_SIZE),
      includeSmall: options.includeSmall ?? false,
    };

    const collect = async (): Promise<ExtractedImage[]> => {
      const raw = await this.page.evaluate(scanImagesInPage, scanOptions);
      const images: ExtractedImage[] = [];
      for (const item of raw) {
        if (isTrackingPixelLike(item.url, item.width, item.height)) continue;
        const parsed = ExtractedImageSchema.safeParse({
          url: item.url,
          alt: item.alt,
          width: item.width,
          height: item.height,
          sourcePage,
          kind: item.kind,
        });
        if (parsed.success) images.push(parsed.data);
      }
      return uniqueBy(images, (image) => image.url);
    };

    try {
      let images = await collect();

      // Lazy/hidden images report 0×0 until the browser has decoded them, which
      // would cripple ranking. Poll briefly for decoding, then scan once more.
      const undecided = images.filter((image) => image.width === 0 && image.height === 0).length;
      if (undecided > 0) {
        await this.waitForImageDecoding(2_500);
        images = await collect();
      }

      log.debug('images extracted', {
        count: images.length,
        undecided: images.filter((image) => image.width === 0 && image.height === 0).length,
      });
      return images.slice(0, options.limit ?? DEFAULT_EXTRACT_LIMIT);
    } catch (error) {
      log.warn('image extraction failed', { error });
      return [];
    }
  }

  /** Waits (bounded) until every `<img>` with a `src` has a decoded size. */
  private async waitForImageDecoding(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    await this.page.waitForLoadState('load', { timeout: 1_000 }).catch(() => undefined);
    while (Date.now() < deadline) {
      const pending = await this.page
        .evaluate(countPendingImagesInPage)
        .catch(() => 0);
      if (pending === 0) return;
      await sleep(120);
    }
  }

  /** Absolute, deduplicated links from the (optionally narrowed) page. */
  async extractLinks(options: LinkExtractOptions = {}): Promise<ExtractedLink[]> {
    const sourcePage = await this.sourceUrl(options.sourcePage);
    const limit = options.limit ?? DEFAULT_EXTRACT_LIMIT;
    try {
      const raw = await this.page.evaluate(scanLinksInPage, {
        selector: options.selector ?? null,
        limit,
        sameSiteOnly: options.sameSiteOnly ?? false,
      });
      const links: ExtractedLink[] = [];
      for (const item of raw) {
        const parsed = ExtractedLinkSchema.safeParse({
          url: item.url,
          text: item.text,
          rel: item.rel || undefined,
          sourcePage,
        });
        if (parsed.success) links.push(parsed.data);
      }
      return uniqueBy(links, (link) => link.url).slice(0, limit);
    } catch (error) {
      log.warn('link extraction failed', { error });
      return [];
    }
  }

  async extractButtons(options: ExtractOptions = {}): Promise<ExtractedButton[]> {
    const sourcePage = await this.sourceUrl(options.sourcePage);
    const limit = options.limit ?? DEFAULT_EXTRACT_LIMIT;
    try {
      const raw = await this.page.evaluate(scanButtonsInPage, {
        selector: options.selector ?? null,
        limit,
      });
      const buttons: ExtractedButton[] = [];
      for (const item of raw) {
        const parsed = ExtractedButtonSchema.safeParse({
          label: item.label,
          role: item.role || undefined,
          testId: item.testId || undefined,
          id: item.id || undefined,
          sourcePage,
        });
        if (parsed.success) buttons.push(parsed.data);
      }
      return buttons.slice(0, limit);
    } catch (error) {
      log.warn('button extraction failed', { error });
      return [];
    }
  }

  async extractInputs(options: ExtractOptions = {}): Promise<ExtractedInput[]> {
    const sourcePage = await this.sourceUrl(options.sourcePage);
    const limit = options.limit ?? DEFAULT_EXTRACT_LIMIT;
    try {
      const raw = await this.page.evaluate(scanInputsInPage, {
        selector: options.selector ?? null,
        limit,
      });
      const inputs: ExtractedInput[] = [];
      for (const item of raw) {
        const parsed = ExtractedInputSchema.safeParse({
          name: item.name || undefined,
          type: item.type || undefined,
          label: item.label || undefined,
          placeholder: item.placeholder || undefined,
          testId: item.testId || undefined,
          id: item.id || undefined,
          sourcePage,
        });
        if (parsed.success) inputs.push(parsed.data);
      }
      return inputs.slice(0, limit);
    } catch (error) {
      log.warn('input extraction failed', { error });
      return [];
    }
  }

  async extractText(options: TextExtractOptions = {}): Promise<ExtractedTextBlock[]> {
    const sourcePage = await this.sourceUrl(options.sourcePage);
    const limit = options.limit ?? DEFAULT_EXTRACT_LIMIT;
    try {
      const raw = await this.page.evaluate(scanTextInPage, {
        selector: options.selector ?? null,
        limit,
        minLength: options.minLength ?? 6,
      });
      const blocks: ExtractedTextBlock[] = [];
      for (const item of raw) {
        if (isLowValueLabel(item.text)) continue;
        const parsed = ExtractedTextBlockSchema.safeParse({
          text: item.text,
          tag: item.tag || undefined,
          sourcePage,
        });
        if (parsed.success) blocks.push(parsed.data);
      }
      return blocks.slice(0, limit);
    } catch (error) {
      log.warn('text extraction failed', { error });
      return [];
    }
  }

  async extractTables(options: ExtractOptions = {}): Promise<ExtractedTable[]> {
    const sourcePage = await this.sourceUrl(options.sourcePage);
    const limit = options.limit ?? 50;
    try {
      const raw = await this.page.evaluate(scanTablesInPage, {
        selector: options.selector ?? null,
        limit,
      });
      const tables: ExtractedTable[] = [];
      for (const item of raw) {
        const parsed = ExtractedTableSchema.safeParse({
          caption: item.caption || undefined,
          headers: item.headers,
          rows: item.rows,
          sourcePage,
        });
        if (parsed.success) tables.push(parsed.data);
      }
      return tables.slice(0, limit);
    } catch (error) {
      log.warn('table extraction failed', { error });
      return [];
    }
  }

  async extractMetadata(): Promise<PageMetadata> {
    const url = await this.sourceUrl();
    try {
      const raw = await this.page.evaluate(scanMetadataInPage);
      return {
        url,
        title: raw.title,
        description: raw.description || undefined,
        canonical: raw.canonical || undefined,
        lang: raw.lang || undefined,
        ogTitle: raw.ogTitle || undefined,
        ogImage: raw.ogImage || undefined,
        jsonLd: raw.jsonLd.slice(0, 20),
      };
    } catch (error) {
      log.warn('metadata extraction failed', { error });
      return { url, title: '', jsonLd: [] };
    }
  }

  /** JSON-LD, OpenGraph and tables in one call (used by the `structuredData` target). */
  async extractStructuredData(options: ExtractOptions = {}): Promise<StructuredDataResult> {
    const [metadata, tables] = await Promise.all([
      this.extractMetadata(),
      this.extractTables({ limit: options.limit ?? 20 }),
    ]);
    return {
      url: metadata.url,
      jsonLd: metadata.jsonLd,
      tables,
      openGraph: {
        ...(metadata.ogTitle ? { title: metadata.ogTitle } : {}),
        ...(metadata.ogImage ? { image: metadata.ogImage } : {}),
      },
    };
  }

  /** Compact observation of the current page (counts + interactive controls). */
  async observe(): Promise<PageState> {
    try {
      const raw = await this.page.evaluate(scanPageStateInPage, { maxInteractive: 40 });
      const parsed = PageStateSchema.safeParse({
        url: raw.url,
        title: raw.title,
        links: raw.links,
        images: raw.images,
        buttons: raw.buttons,
        inputs: raw.inputs,
        forms: raw.forms,
        headings: raw.headings,
        textLength: raw.textLength,
        interactive: raw.interactive.map((item) => ({
          kind: item.kind as 'link' | 'button' | 'input' | 'select' | 'textarea',
          label: item.label,
          ...(item.role ? { role: item.role } : {}),
          ...(item.testId ? { testId: item.testId } : {}),
          ...(item.id ? { id: item.id } : {}),
        })),
        capturedAt: new Date().toISOString(),
      });
      if (parsed.success) return parsed.data;
      log.warn('page state failed validation', { issues: parsed.error.issues.length });
      return this.emptyPageState(raw.url);
    } catch (error) {
      log.warn('page observation failed', { error });
      return this.emptyPageState('');
    }
  }

  private emptyPageState(url: string): PageState {
    return {
      url,
      title: '',
      links: 0,
      images: 0,
      buttons: 0,
      inputs: 0,
      forms: 0,
      headings: 0,
      textLength: 0,
      interactive: [],
      capturedAt: new Date().toISOString(),
    };
  }

  /** Dispatcher used by the action executor. */
  async extract(target: ExtractTarget, options: ExtractOptions = {}): Promise<unknown> {
    switch (target) {
      case 'images':
        return this.extractImages(options);
      case 'links':
        return this.extractLinks(options);
      case 'buttons':
        return this.extractButtons(options);
      case 'inputs':
        return this.extractInputs(options);
      case 'text':
        return this.extractText(options);
      case 'metadata':
        return this.extractMetadata();
      case 'structuredData':
        return this.extractStructuredData(options);
      case 'tables':
        return this.extractTables(options);
    }
  }
}
