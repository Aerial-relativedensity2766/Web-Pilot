/**
 * @webpilot/extraction-core
 *
 * Deterministic DOM extraction (no AI): text, links, images, buttons, inputs,
 * metadata, structured data and tables, plus the compact page observation model
 * used by the agent and the AI context builder.
 */
import type { Page } from 'playwright';
import { Extractor } from './extractor';
import type {
  ExtractOptions,
  ImageExtractOptions,
  LinkExtractOptions,
  TextExtractOptions,
} from './types';

export { Extractor } from './extractor';
export type { StructuredDataResult } from './extractor';
export * from './types';

/** Convenience wrappers so single-shot extraction does not need a class. */

export function extractImages(
  page: Page,
  options: ImageExtractOptions = {},
): ReturnType<Extractor['extractImages']> {
  return new Extractor(page).extractImages(options);
}

export function extractLinks(
  page: Page,
  options: LinkExtractOptions = {},
): ReturnType<Extractor['extractLinks']> {
  return new Extractor(page).extractLinks(options);
}

export function extractButtons(
  page: Page,
  options: ExtractOptions = {},
): ReturnType<Extractor['extractButtons']> {
  return new Extractor(page).extractButtons(options);
}

export function extractInputs(
  page: Page,
  options: ExtractOptions = {},
): ReturnType<Extractor['extractInputs']> {
  return new Extractor(page).extractInputs(options);
}

export function extractText(
  page: Page,
  options: TextExtractOptions = {},
): ReturnType<Extractor['extractText']> {
  return new Extractor(page).extractText(options);
}

export function extractTables(
  page: Page,
  options: ExtractOptions = {},
): ReturnType<Extractor['extractTables']> {
  return new Extractor(page).extractTables(options);
}

export function extractMetadata(page: Page): ReturnType<Extractor['extractMetadata']> {
  return new Extractor(page).extractMetadata();
}

export function extractStructuredData(
  page: Page,
  options: ExtractOptions = {},
): ReturnType<Extractor['extractStructuredData']> {
  return new Extractor(page).extractStructuredData(options);
}

export function extract(
  page: Page,
  target: Parameters<Extractor['extract']>[0],
  options: ExtractOptions = {},
): Promise<unknown> {
  return new Extractor(page).extract(target, options);
}