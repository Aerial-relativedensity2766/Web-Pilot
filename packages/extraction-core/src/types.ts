/**
 * Extraction options and raw (browser side) result shapes.
 *
 * The `scripts/*` modules in this package are serialized into the page by
 * Playwright, so they must be completely self contained: no imports, no
 * references to module scope. Everything they need arrives as an argument.
 */

export interface ExtractOptions {
  /** Narrow the scan to a subtree (CSS selector). */
  selector?: string | null;
  /** Hard cap on returned items. */
  limit?: number;
  /** Page the items came from, echoed back into the result. */
  sourcePage?: string;
  /** Free text query, used later for semantic ranking. */
  query?: string;
}

export interface ImageExtractOptions extends ExtractOptions {
  minWidth?: number;
  minHeight?: number;
  /** Keep small icons/thumbnails too (default false). */
  includeSmall?: boolean;
}

export interface LinkExtractOptions extends ExtractOptions {
  /** Only return links on the same registrable host. */
  sameSiteOnly?: boolean;
}

export interface TextExtractOptions extends ExtractOptions {
  minLength?: number;
}

export const DEFAULT_EXTRACT_LIMIT = 200;
export const DEFAULT_MIN_IMAGE_SIZE = 64;

/** Raw image scan result, before it is validated into an `ExtractedImage`. */
export interface ImageScanResult {
  url: string;
  alt: string;
  width: number;
  height: number;
  kind: string;
}

export interface LinkScanResult {
  url: string;
  text: string;
  rel: string;
}

export interface ButtonScanResult {
  label: string;
  role: string;
  testId: string;
  id: string;
}

export interface InputScanResult {
  name: string;
  type: string;
  label: string;
  placeholder: string;
  testId: string;
  id: string;
}

export interface TextScanResult {
  text: string;
  tag: string;
}

export interface TableScanResult {
  caption: string;
  headers: string[];
  rows: string[][];
}

export interface MetadataScanResult {
  title: string;
  description: string;
  canonical: string;
  lang: string;
  ogTitle: string;
  ogImage: string;
  jsonLd: unknown[];
}

export interface PageStateScanResult {
  url: string;
  title: string;
  links: number;
  images: number;
  buttons: number;
  inputs: number;
  forms: number;
  headings: number;
  textLength: number;
  interactive: Array<{
    kind: string;
    label: string;
    role: string;
    testId: string;
    id: string;
  }>;
}