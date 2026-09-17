import { describe, expect, it, beforeAll } from 'bun:test';
import { Extractor } from '@webpilot/extraction-core';
import { ensureTestSiteRunning, siteUrl, withBrowser } from './support';

/**
 * Integration: extractor → live DOM.
 * The fixture search page always renders 16 images for a tree query, four of
 * which are deliberately irrelevant, plus a 1×1 tracking pixel and one URL that
 * serves HTML with an image content type.
 */

beforeAll(async () => {
  await ensureTestSiteRunning();
});

describe('Extractor', () => {
  it('extracts images with dimensions, alt text and provenance', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl('search?q=tree'));
      const extractor = new Extractor(await manager.currentPage());
      const images = await extractor.extractImages();

      expect(images.length).toBeGreaterThanOrEqual(12);
      expect(images.some((image) => /oak tree/i.test(image.alt))).toBe(true);
      expect(images.every((image) => image.sourcePage.includes('/search'))).toBe(true);
      expect(images.every((image) => image.url.startsWith('http'))).toBe(true);
      expect(images.some((image) => image.width >= 700)).toBe(true);
      // unique URLs only
      expect(new Set(images.map((image) => image.url)).size).toBe(images.length);
    });
  });

  it('filters the 1x1 tracking pixel', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl('search?q=tree'));
      const images = await new Extractor(await manager.currentPage()).extractImages();
      expect(images.some((image) => image.url.includes('tracking-pixel'))).toBe(false);
      expect(images.every((image) => image.width > 2 || image.width === 0)).toBe(true);
    });
  });

  it('extracts links, buttons and inputs', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl('search?q=tree'));
      const extractor = new Extractor(await manager.currentPage());

      const links = await extractor.extractLinks();
      expect(links.some((link) => link.url.includes('/articles/why-trees-matter'))).toBe(true);
      expect(links.some((link) => /tree/i.test(link.text))).toBe(true);

      const buttons = await extractor.extractButtons();
      expect(buttons.some((button) => button.testId === 'search-button')).toBe(true);
      expect(buttons.some((button) => /Load more/i.test(button.label))).toBe(true);

      const inputs = await extractor.extractInputs();
      const search = inputs.find((input) => input.testId === 'search-input');
      expect(search).toBeDefined();
      expect(search?.type).toBe('search');
      expect(search?.label).toContain('Search the fixture library');
    });
  });

  it('extracts metadata, JSON-LD and tables', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl('products'));
      const extractor = new Extractor(await manager.currentPage());

      const metadata = await extractor.extractMetadata();
      expect(metadata.title).toContain('Products');
      expect(metadata.description).toBeTruthy();
      expect(metadata.jsonLd.length).toBeGreaterThan(0);

      const structured = await extractor.extractStructuredData();
      expect(structured.tables.length).toBeGreaterThan(0);

      const tables = await extractor.extractTables();
      const table = tables[0];
      expect(table).toBeDefined();
      expect(table?.headers).toEqual(['Product', 'Price', 'RAM', 'Availability']);
      expect(table?.rows.length).toBe(4);
      expect(table?.rows[0]?.[0]).toContain('Aero');

      const text = await extractor.extractText();
      expect(text.length).toBeGreaterThanOrEqual(3);
      expect(text.some((block) => block.tag === 'h2')).toBe(true);
    });
  });

  it('dispatches through extract(target)', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl('search?q=tree'));
      const page = await manager.currentPage();
      const images = (await new Extractor(page).extract('images', { limit: 5 })) as unknown[];
      expect(images.length).toBeLessThanOrEqual(5);
      const metadata = await new Extractor(page).extract('metadata');
      expect(metadata).toBeDefined();
    });
  });

  it('narrows extraction with a css selector', async () => {
    await withBrowser(async ({ manager }) => {
      await manager.navigate(siteUrl('products'));
      const extractor = new Extractor(await manager.currentPage());
      const buttons = await extractor.extractButtons({ selector: 'section' });
      expect(buttons.some((button) => button.testId === 'filter-32gb')).toBe(true);
    });
  });
});
