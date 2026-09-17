import {
  IMAGE_CATALOG,
  MISLABELLED_IMAGE_SLUG,
  OVERSIZED_IMAGE_SLUG,
  TRACKING_PIXEL_SLUG,
} from './fixtures';
import { encodePngImage, oversizedPayload, TRACKING_PIXEL_GIF } from './png';
import { articlePage, homePage, notFoundPage, productsPage, searchPage } from './pages';

/**
 * Deterministic fixture website for integration and end-to-end tests.
 *
 * Never point WebPilot's tests at a live search engine: this server gives exact,
 * repeatable expectations for search → extract → rank → download.
 *
 *   bun run apps/test-site/src/server.ts    →  http://127.0.0.1:3001/test-site/
 */

const PORT = Number(process.env.TEST_SITE_PORT ?? 3001);
const HOST = process.env.TEST_SITE_HOST ?? '127.0.0.1';
const PREFIX = '/test-site';

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: HTML_HEADERS });
}

function imageResponse(bytes: Uint8Array, type: string): Response {
  const body = new Uint8Array(bytes);
  return new Response(body.buffer as ArrayBuffer, {
    headers: {
      'content-type': type,
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
    },
  });
}

function pngFor(slug: string, width?: number, height?: number): Response {
  const fixture =
    IMAGE_CATALOG.find((image) => image.slug === slug) ??
    IMAGE_CATALOG[Math.abs(hashCode(slug)) % IMAGE_CATALOG.length]!;
  const bytes = encodePngImage(
    width ?? fixture.width,
    height ?? fixture.height,
    fixture.color,
  );
  return imageResponse(bytes, 'image/png');
}

function hashCode(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return hash;
}

function stripPrefix(pathname: string): string {
  if (pathname === PREFIX) return '/';
  if (pathname.startsWith(`${PREFIX}/`)) return pathname.slice(PREFIX.length);
  return pathname;
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(request) {
    const url = new URL(request.url);
    const path = stripPrefix(url.pathname);

    // --- pages ---------------------------------------------------------------
    if (path === '/' || path === '') return html(homePage());

    if (path === '/search') {
      return html(searchPage(url.searchParams.get('q') ?? '', url.searchParams.get('view') ?? ''));
    }

    if (path === '/products') return html(productsPage());

    if (path.startsWith('/articles/')) {
      const page = articlePage(path.replace('/articles/', ''));
      return page ? html(page) : html(notFoundPage(path), 404);
    }

    // --- images --------------------------------------------------------------
    if (path.startsWith('/images/')) {
      const file = path.replace('/images/', '');

      if (file === MISLABELLED_IMAGE_SLUG) {
        // Advertises an image but returns HTML: the downloader must reject it.
        return new Response('<html><body><h1>Not an image</h1></body></html>', {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
        });
      }

      if (file === OVERSIZED_IMAGE_SLUG) {
        return imageResponse(oversizedPayload(4 * 1_024 * 1_024), 'image/png');
      }

      if (file === TRACKING_PIXEL_SLUG) {
        return imageResponse(TRACKING_PIXEL_GIF, 'image/gif');
      }

      const slug = file.replace(/\.[a-z0-9]+$/i, '');
      const width = Number(url.searchParams.get('w') ?? 0) || undefined;
      const height = Number(url.searchParams.get('h') ?? 0) || undefined;
      return pngFor(slug, width, height);
    }

    // --- downloads -----------------------------------------------------------
    if (path === '/downloads/sample.txt') {
      const body = new TextEncoder().encode('WebPilot fixture text file.\n');
      return new Response(body.buffer as ArrayBuffer, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (path === '/downloads/sample.json') {
      const body = new TextEncoder().encode(JSON.stringify({ fixture: true, items: [1, 2, 3] }));
      return new Response(body.buffer as ArrayBuffer, {
        headers: { 'content-type': 'application/json' },
      });
    }

    // --- meta ----------------------------------------------------------------
    if (path === '/robots.txt') {
      return new Response(
        ['User-agent: *', 'Allow: /', 'Crawl-delay: 0', ''].join('\n'),
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

    if (path === '/health') {
      return Response.json({ ok: true, site: 'webpilot-test-site', images: IMAGE_CATALOG.length });
    }

    if (path === '/slow') {
      const ms = Math.min(10_000, Number(url.searchParams.get('ms') ?? 500));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return html(homePage());
    }

    return html(notFoundPage(path), 404);
  },
});

// eslint-disable-next-line no-console
console.log(`[test-site] listening on http://${HOST}:${server.port}${PREFIX}/`);
