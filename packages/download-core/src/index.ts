/**
 * @webpilot/download-core
 *
 * Permitted resource downloading with verification, hashing, deduplication and
 * provenance manifests. Used directly by the agent executor and exposed to the
 * API for listing/streaming already downloaded files.
 */
export * from './dedupe';
export * from './downloader';
export * from './manifest';
export * from './naming';
export * from './verify';