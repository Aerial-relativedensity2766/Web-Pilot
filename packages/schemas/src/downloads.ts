import { z } from 'zod';

export const DOWNLOAD_STATUSES = ['pending', 'completed', 'failed', 'skipped'] as const;
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number];
export const DownloadStatusSchema = z.enum(DOWNLOAD_STATUSES);

/** Persisted record of one download attempt (successful or not). */
export const DownloadRecordSchema = z.strictObject({
  id: z.string(),
  taskId: z.string(),
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().min(0),
  sha256: z.string().nullable().optional(),
  status: DownloadStatusSchema,
  /** where the candidate was discovered (page URL) */
  sourcePage: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type DownloadRecord = z.infer<typeof DownloadRecordSchema>;

export const DownloadManifestFileSchema = z.strictObject({
  filename: z.string(),
  sourceUrl: z.string(),
  mimeType: z.string(),
  size: z.number().int().min(0),
  sha256: z.string(),
  sourcePage: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
  /** semantic relevance score that selected this file, when ranked */
  relevance: z.number().optional(),
  downloadedAt: z.string(),
});

export type DownloadManifestFile = z.infer<typeof DownloadManifestFileSchema>;

/**
 * `manifest.json` written into every task directory: full provenance for the
 * files WebPilot fetched on the user's behalf.
 */
export const DownloadManifestSchema = z.strictObject({
  taskId: z.string(),
  goal: z.string().nullable().optional(),
  createdAt: z.string(),
  files: z.array(DownloadManifestFileSchema),
  totals: z.strictObject({
    files: z.number().int().min(0),
    bytes: z.number().int().min(0),
  }),
});

export type DownloadManifest = z.infer<typeof DownloadManifestSchema>;

export const DownloadRequestSchema = z.strictObject({
  url: z.string(),
  filename: z.string().optional(),
  alt: z.string().optional(),
  sourcePage: z.string().optional(),
});

export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;

export const DownloadOutcomeSchema = z.strictObject({
  ok: z.boolean(),
  record: DownloadRecordSchema,
  /** true when an identical sha256 was already stored in this task folder */
  duplicate: z.boolean().optional(),
  path: z.string().nullable().optional(),
});

export type DownloadOutcome = z.infer<typeof DownloadOutcomeSchema>;