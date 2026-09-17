import { z } from 'zod';

/**
 * Snapshot of the browser page *after* an action.
 *
 * Only counts and small summaries live here — never the raw HTML — because this
 * object is what gets serialized into the AI context window.
 */
export const PageStateSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  links: z.number().int().min(0),
  images: z.number().int().min(0),
  buttons: z.number().int().min(0),
  inputs: z.number().int().min(0),
  forms: z.number().int().min(0),
  headings: z.number().int().min(0),
  textLength: z.number().int().min(0),
  /** short list of visible interactive controls, for the AI context */
  interactive: z
    .array(
      z.strictObject({
        kind: z.enum(['link', 'button', 'input', 'select', 'textarea']),
        label: z.string().max(160),
        role: z.string().max(40).optional(),
        testId: z.string().max(80).optional(),
        id: z.string().max(80).optional(),
      }),
    )
    .max(40),
  capturedAt: z.string(),
});

export type PageState = z.infer<typeof PageStateSchema>;

export const ExtractedImageSchema = z.strictObject({
  url: z.string(),
  alt: z.string(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  sourcePage: z.string(),
  /** `thumbnail`, `og`, `content` … best-effort classification */
  kind: z.enum(['content', 'thumbnail', 'background', 'og', 'unknown']).optional(),
});

export type ExtractedImage = z.infer<typeof ExtractedImageSchema>;

export const ExtractedLinkSchema = z.strictObject({
  url: z.string(),
  text: z.string(),
  rel: z.string().optional(),
  sourcePage: z.string(),
});

export type ExtractedLink = z.infer<typeof ExtractedLinkSchema>;

export const ExtractedButtonSchema = z.strictObject({
  label: z.string(),
  role: z.string().optional(),
  testId: z.string().optional(),
  id: z.string().optional(),
  sourcePage: z.string(),
});

export type ExtractedButton = z.infer<typeof ExtractedButtonSchema>;

export const ExtractedInputSchema = z.strictObject({
  name: z.string().optional(),
  type: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  testId: z.string().optional(),
  id: z.string().optional(),
  sourcePage: z.string(),
});

export type ExtractedInput = z.infer<typeof ExtractedInputSchema>;

export const ExtractedTextBlockSchema = z.strictObject({
  text: z.string(),
  tag: z.string().optional(),
  sourcePage: z.string(),
});

export type ExtractedTextBlock = z.infer<typeof ExtractedTextBlockSchema>;

export const ExtractedTableSchema = z.strictObject({
  caption: z.string().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())).max(500),
  sourcePage: z.string(),
});

export type ExtractedTable = z.infer<typeof ExtractedTableSchema>;

export const PageMetadataSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  description: z.string().optional(),
  canonical: z.string().optional(),
  lang: z.string().optional(),
  ogTitle: z.string().optional(),
  ogImage: z.string().optional(),
  /** `application/ld+json` payloads, kept as parsed JSON values */
  jsonLd: z.array(z.unknown()).max(20),
});

export type PageMetadata = z.infer<typeof PageMetadataSchema>;

/** Anything the extractor can hand back, before semantic ranking. */
export type ExtractedItem =
  | ExtractedImage
  | ExtractedLink
  | ExtractedButton
  | ExtractedInput
  | ExtractedTextBlock
  | ExtractedTable;

export const RankedItemSchema = z.strictObject({
  /** URL (images/links) or a text digest used as the ranking key */
  key: z.string(),
  kind: z.enum(['image', 'link', 'text', 'button', 'input', 'table']),
  /** free text the embedding was computed from */
  text: z.string(),
  score: z.number(),
  /** score of the lexical (rule based) signal, 0..1 */
  lexicalScore: z.number().min(0).max(1).optional(),
  /** score of the embedding signal, 0..1 */
  semanticScore: z.number().min(0).max(1).optional(),
  item: z.unknown(),
});

export type RankedItem = z.infer<typeof RankedItemSchema>;
