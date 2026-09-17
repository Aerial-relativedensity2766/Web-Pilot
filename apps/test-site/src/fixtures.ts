/**
 * Deterministic fixture catalogue for the local test site.
 *
 * `alt` text is deliberately mixed: 12 tree related images and 4 obvious
 * distractors, so semantic ranking can be asserted on exact expectations.
 */

export interface FixtureImage {
  slug: string;
  alt: string;
  width: number;
  height: number;
  /** solid colour of the generated PNG, unique per slug */
  color: [number, number, number];
  /** true when the image is relevant to the query "tree" */
  relevant: boolean;
  caption: string;
}

export const IMAGE_CATALOG: FixtureImage[] = [
  {
    slug: 'oak-tree-meadow',
    alt: 'large green oak tree standing in a meadow',
    width: 960,
    height: 640,
    color: [34, 139, 34],
    relevant: true,
    caption: 'Oak tree in a meadow',
  },
  {
    slug: 'pine-forest',
    alt: 'pine forest of tall conifer trees in autumn light',
    width: 900,
    height: 600,
    color: [21, 96, 60],
    relevant: true,
    caption: 'Pine forest',
  },
  {
    slug: 'treehouse-woods',
    alt: 'wooden treehouse built into an old oak tree',
    width: 880,
    height: 660,
    color: [120, 82, 45],
    relevant: true,
    caption: 'Treehouse in the woods',
  },
  {
    slug: 'cherry-blossom-tree',
    alt: 'cherry blossom tree in a spring park',
    width: 840,
    height: 620,
    color: [240, 170, 200],
    relevant: true,
    caption: 'Cherry blossom tree',
  },
  {
    slug: 'red-maple-leaf-tree',
    alt: 'red maple tree with bright autumn leaves',
    width: 820,
    height: 610,
    color: [180, 60, 40],
    relevant: true,
    caption: 'Red maple tree',
  },
  {
    slug: 'birch-grove',
    alt: 'birch trees grove covered in fresh snow',
    width: 800,
    height: 640,
    color: [225, 228, 232],
    relevant: true,
    caption: 'Birch grove',
  },
  {
    slug: 'tree-roots-moss',
    alt: 'tree roots spreading over mossy rocks',
    width: 860,
    height: 600,
    color: [70, 120, 70],
    relevant: true,
    caption: 'Tree roots',
  },
  {
    slug: 'tree-line-sunset',
    alt: 'tree line silhouette against a sunset sky',
    width: 920,
    height: 520,
    color: [210, 130, 60],
    relevant: true,
    caption: 'Tree line at sunset',
  },
  {
    slug: 'bonsai-tree-pot',
    alt: 'small bonsai tree in a ceramic pot',
    width: 700,
    height: 700,
    color: [60, 110, 50],
    relevant: true,
    caption: 'Bonsai tree',
  },
  {
    slug: 'palm-tree-beach',
    alt: 'palm tree leaning over a tropical beach',
    width: 880,
    height: 620,
    color: [200, 190, 90],
    relevant: true,
    caption: 'Palm tree',
  },
  {
    slug: 'christmas-tree-room',
    alt: 'decorated christmas tree in a living room',
    width: 760,
    height: 680,
    color: [20, 70, 40],
    relevant: true,
    caption: 'Christmas tree',
  },
  {
    slug: 'apple-tree-orchard',
    alt: 'apple tree with ripe red apples in an orchard',
    width: 900,
    height: 620,
    color: [150, 40, 45],
    relevant: true,
    caption: 'Apple tree',
  },
  {
    slug: 'toyota-engine-block',
    alt: 'toyota engine block on a workshop bench',
    width: 880,
    height: 600,
    color: [90, 90, 100],
    relevant: false,
    caption: 'Engine block',
  },
  {
    slug: 'laptop-on-desk',
    alt: 'laptop computer on a wooden desk',
    width: 900,
    height: 620,
    color: [40, 60, 90],
    relevant: false,
    caption: 'Laptop on a desk',
  },
  {
    slug: 'coffee-cup',
    alt: 'ceramic coffee cup on a saucer',
    width: 700,
    height: 620,
    color: [140, 100, 70],
    relevant: false,
    caption: 'Coffee cup',
  },
  {
    slug: 'mountain-lake-dawn',
    alt: 'mountain lake reflection at dawn',
    width: 980,
    height: 580,
    color: [70, 110, 160],
    relevant: false,
    caption: 'Mountain lake',
  },
];

export const TREE_IMAGES = IMAGE_CATALOG.filter((image) => image.relevant);

/** Broken endpoint: advertises `image/jpeg` but returns an HTML error page. */
export const MISLABELLED_IMAGE_SLUG = 'mislabeled.jpg';

/** Endpoint that streams more bytes than the configured size limit. */
export const OVERSIZED_IMAGE_SLUG = 'oversized.png';

/** 1x1 tracking beacon that must be filtered out before ranking. */
export const TRACKING_PIXEL_SLUG = 'tracking-pixel.gif';

export interface FixtureProduct {
  name: string;
  price: string;
  ram: string;
  stock: string;
}

export const PRODUCTS: FixtureProduct[] = [
  { name: 'Aero 14 Laptop', price: '$1,299', ram: '32 GB', stock: 'in stock' },
  { name: 'Vector 16 Workstation', price: '$2,450', ram: '64 GB', stock: 'in stock' },
  { name: 'Nimbus 13 Ultrabook', price: '$899', ram: '16 GB', stock: 'out of stock' },
  { name: 'Forge 15 Gaming', price: '$1,780', ram: '32 GB', stock: 'in stock' },
];

export interface FixtureArticle {
  slug: string;
  title: string;
  summary: string;
}

export const ARTICLES: FixtureArticle[] = [
  {
    slug: 'why-trees-matter',
    title: 'Why urban trees matter for cooling cities',
    summary: 'A look at how tree canopy reduces street temperature.',
  },
  {
    slug: 'tree-planting-guide',
    title: 'A practical tree planting guide',
    summary: 'Choosing a tree species, soil preparation and watering.',
  },
  {
    slug: 'wasm-in-the-browser',
    title: 'WebAssembly in the browser: a field report',
    summary: 'What WebAssembly is good at, and what it is not.',
  },
];