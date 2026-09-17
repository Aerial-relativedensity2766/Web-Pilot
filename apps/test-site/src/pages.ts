import {
  ARTICLES,
  IMAGE_CATALOG,
  PRODUCTS,
  TREE_IMAGES,
  TRACKING_PIXEL_SLUG,
} from './fixtures';

/**
 * Server rendered fixture pages.
 *
 * Deliberately includes accessibility roles, `data-testid` attributes, stable
 * ids, images, links, tables and JSON-LD so every extraction path and every
 * locator strategy can be exercised deterministically.
 */

interface LayoutOptions {
  title: string;
  description: string;
  body: string;
  jsonLd?: unknown;
  canonicalPath: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(options: LayoutOptions): string {
  const jsonLd = options.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(options.jsonLd)}</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)}</title>
  <meta name="description" content="${escapeHtml(options.description)}" />
  <meta property="og:title" content="${escapeHtml(options.title)}" />
  <meta property="og:image" content="/test-site/images/oak-tree-meadow.png?w=960&h=640" />
  <link rel="canonical" href="${escapeHtml(options.canonicalPath)}" />
  <meta name="robots" content="index,follow" />
  ${jsonLd}
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; max-width: 72rem; }
    nav a { margin-right: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    figure { margin: 0; }
    img { max-width: 100%; height: auto; display: block; }
    table { border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #8888; padding: .35rem .6rem; text-align: left; }
    .banner { border: 1px dashed #8888; padding: .5rem .75rem; margin: 1rem 0; }
    #load-more-target figure.extra { display: none; }
    body.show-extra #load-more-target figure.extra { display: block; }
  </style>
</head>
<body>
  <header>
    <h1>WebPilot Fixture Site</h1>
    <nav aria-label="Main">
      <a href="./" data-testid="nav-home">Home</a>
      <a href="products" data-testid="nav-products">Products</a>
      <a href="articles/why-trees-matter" data-testid="nav-article">Tree article</a>
      <a href="robots.txt">robots.txt</a>
    </nav>
  </header>
  <main>
${options.body}
  </main>
  <footer><p>Local fixture site for WebPilot tests. No tracking, no external requests.</p></footer>
</body>
</html>`;
}

function searchForm(query = ''): string {
  return `
  <form action="search" method="get" role="search">
    <label for="search-query">Search the fixture library</label>
    <input id="search-query" name="q" type="search" placeholder="Search images"
           data-testid="search-input" value="${escapeHtml(query)}" />
    <button type="submit" data-testid="search-button">Search</button>
    <button type="button" data-testid="images-tab" id="images-tab">Images</button>
    <button type="button" data-testid="show-banner" id="show-banner">Show notice</button>
    <button type="button" data-testid="load-more" id="load-more">Load more results</button>
  </form>
  <div class="banner" id="notice" hidden>Some notices are dismissible.</div>`;
}

const INLINE_SCRIPT = `<script>
  document.getElementById('show-banner')?.addEventListener('click', () => {
    const notice = document.getElementById('notice');
    if (notice) notice.hidden = false;
  });
  document.getElementById('load-more')?.addEventListener('click', () => {
    document.body.classList.add('show-extra');
    const count = document.getElementById('result-count');
    if (count) count.textContent = '16 results';
  });
  document.getElementById('images-tab')?.addEventListener('click', () => {
    const form = document.querySelector('form[role="search"]');
    if (form instanceof HTMLFormElement) {
      form.querySelector('input[name="view"]')?.remove();
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'view';
      hidden.value = 'images';
      form.appendChild(hidden);
      form.requestSubmit();
    }
  });
</script>`;

function imageFigure(
  image: (typeof IMAGE_CATALOG)[number],
  index: number,
  extraClass = '',
): string {
  const src = `images/${image.slug}.png?w=${image.width}&h=${image.height}`;
  return `<figure class="${extraClass}" data-testid="result-item-${index}">
        <img src="${src}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="eager" />
        <figcaption>${escapeHtml(image.caption)}</figcaption>
      </figure>`;
}

export function homePage(): string {
  return layout({
    title: 'WebPilot Fixture Site — search images, products and articles',
    description:
      'A deterministic local website with a search box, buttons, images, links and tables used by WebPilot tests.',
    canonicalPath: '/test-site/',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'WebPilot Fixture Site',
      url: '/test-site/',
      potentialAction: {
        '@type': 'SearchAction',
        target: '/test-site/search?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
    body: `
    <section>
      <h2>Search the library</h2>
      ${searchForm()}
      <p id="result-count">0 results</p>
    </section>
    <section>
      <h2>Featured trees</h2>
      <div class="grid">
        ${imageFigure(IMAGE_CATALOG[0]!, 1)}
        ${imageFigure(IMAGE_CATALOG[1]!, 2)}
        ${imageFigure(IMAGE_CATALOG[12]!, 3)}
      </div>
      <img src="images/${TRACKING_PIXEL_SLUG}" alt="" width="1" height="1" />
    </section>
    <section>
      <h2>Recently published</h2>
      <ul>
        ${ARTICLES.map(
          (article) =>
            `<li><a href="articles/${article.slug}" data-testid="article-${article.slug}">${escapeHtml(article.title)}</a></li>`,
        ).join('\n        ')}
      </ul>
    </section>
    ${INLINE_SCRIPT}`,
  });
}

export function searchPage(query: string, view: string): string {
  const normalized = query.trim().toLowerCase();
  const isTreeQuery = /tree|trees|oak|pine|palm|maple|birch|bonsai|leaf|forest/.test(normalized);
  const images = isTreeQuery
    ? [...TREE_IMAGES, ...IMAGE_CATALOG.filter((image) => !image.relevant)]
    : IMAGE_CATALOG;

  return layout({
    title: `Search results for "${query}" — WebPilot Fixture Site`,
    description: `Fixture search results page for the query ${query}.`,
    canonicalPath: `/test-site/search?q=${encodeURIComponent(query)}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `Results for ${query}`,
      numberOfItems: images.length,
      itemListElement: images.slice(0, 5).map((image, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: image.caption,
      })),
    },
    body: `
    <section>
      <h2>Results for &ldquo;${escapeHtml(query)}&rdquo;${view ? ` (${escapeHtml(view)})` : ''}</h2>
      ${searchForm(query)}
      <p id="result-count">${images.length} results</p>
      <div class="grid" id="load-more-target">
        ${images
          .map((image, index) => imageFigure(image, index + 1, index >= 8 ? 'extra' : ''))
          .join('\n        ')}
      </div>
    </section>
    <section>
      <h2>Articles</h2>
      <ul>
        ${ARTICLES.map(
          (article) =>
            `<li><a href="articles/${article.slug}" data-testid="result-article-${article.slug}">${escapeHtml(article.title)}</a><p>${escapeHtml(article.summary)}</p></li>`,
        ).join('\n        ')}
      </ul>
      <p><img src="images/${TRACKING_PIXEL_SLUG}" alt="" width="1" height="1" /></p>
      <p><img src="images/mislabeled.jpg" alt="photograph of a tree that is actually an error page" width="800" height="600" /></p>
    </section>
    ${INLINE_SCRIPT}`,
  });
}

export function productsPage(): string {
  return layout({
    title: 'Products — WebPilot Fixture Site',
    description: 'Laptop fixtures with RAM and prices, for table extraction tests.',
    canonicalPath: '/test-site/products',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: PRODUCTS.map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Product',
          name: product.name,
          offers: { '@type': 'Offer', price: product.price.replace(/[^0-9]/g, '') },
        },
      })),
    },
    body: `
    <section>
      <h2>Laptops</h2>
      <table data-testid="product-table">
        <caption>Laptop catalogue with memory and availability</caption>
        <thead>
          <tr><th scope="col">Product</th><th scope="col">Price</th><th scope="col">RAM</th><th scope="col">Availability</th></tr>
        </thead>
        <tbody>
          ${PRODUCTS.map(
            (product) =>
              `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.price)}</td><td>${escapeHtml(product.ram)}</td><td>${escapeHtml(product.stock)}</td></tr>`,
          ).join('\n          ')}
        </tbody>
      </table>
      <button type="button" data-testid="filter-32gb" id="filter-32gb">Show only 32 GB</button>
    </section>
    <script>
      document.getElementById('filter-32gb')?.addEventListener('click', () => {
        document.querySelectorAll('[data-testid="product-table"] tbody tr').forEach((row) => {
          const ram = row.children[2]?.textContent ?? '';
          row.hidden = !ram.includes('32 GB');
        });
      });
    </script>`,
  });
}

export function articlePage(slug: string): string | null {
  const article = ARTICLES.find((entry) => entry.slug === slug);
  if (!article) return null;
  return layout({
    title: `${article.title} — WebPilot Fixture Site`,
    description: article.summary,
    canonicalPath: `/test-site/articles/${article.slug}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      description: article.summary,
      author: { '@type': 'Organization', name: 'WebPilot Fixture Site' },
    },
    body: `
    <article>
      <h2 data-testid="article-title">${escapeHtml(article.title)}</h2>
      <p>${escapeHtml(article.summary)}</p>
      <p>This fixture article exists so WebPilot can extract headings, paragraphs and
      structured data deterministically. It contains no external assets and no tracking.</p>
      <ul>
        <li>Deterministic markup</li>
        <li>Accessible names on every control</li>
        <li>Stable <code>data-testid</code> attributes</li>
      </ul>
    </article>`,
  });
}

export function notFoundPage(path: string): string {
  return layout({
    title: 'Not found — WebPilot Fixture Site',
    description: 'The requested fixture page does not exist.',
    canonicalPath: path,
    body: `<h2>404 — no fixture at ${escapeHtml(path)}</h2>`,
  });
}