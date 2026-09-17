import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  DownloadManifestSchema,
  type DownloadManifest,
  type DownloadManifestFile,
} from '@webpilot/schemas';
import { nowIso, safeJoin } from '@webpilot/shared';

export const MANIFEST_FILENAME = 'manifest.json';

export function manifestFileFor(taskDirectory: string): string {
  return safeJoin(taskDirectory, MANIFEST_FILENAME);
}

export function emptyManifest(taskId: string, goal?: string | null): DownloadManifest {
  return {
    taskId,
    goal: goal ?? null,
    createdAt: nowIso(),
    files: [],
    totals: { files: 0, bytes: 0 },
  };
}

/**
 * Reads (and repairs) a manifest. A malformed manifest is never fatal: WebPilot
 * rebuilds it from scratch so a task can always continue.
 */
export function readManifest(taskDirectory: string, taskId: string, goal?: string | null): DownloadManifest {
  const file = manifestFileFor(taskDirectory);
  if (!existsSync(file)) return emptyManifest(taskId, goal);
  try {
    const parsed = DownloadManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (parsed.success) return recalculateTotals(parsed.data);
  } catch {
    // fall through to a fresh manifest
  }
  return emptyManifest(taskId, goal);
}

/**
 * Writes the manifest atomically (temp file + rename) so a crash mid-write can
 * never leave a truncated JSON document behind.
 */
export function writeManifest(taskDirectory: string, manifest: DownloadManifest): DownloadManifest {
  const normalized = recalculateTotals(manifest);
  const target = manifestFileFor(taskDirectory);
  const temp = safeJoin(taskDirectory, `${MANIFEST_FILENAME}.tmp`);
  writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
  return normalized;
}

export function recalculateTotals(manifest: DownloadManifest): DownloadManifest {
  return {
    ...manifest,
    totals: {
      files: manifest.files.length,
      bytes: manifest.files.reduce((sum, entry) => sum + entry.size, 0),
    },
  };
}

/** Appends a file to the manifest and persists it immediately. */
export function appendManifestFile(
  taskDirectory: string,
  manifest: DownloadManifest,
  file: DownloadManifestFile,
): DownloadManifest {
  const alreadyRecorded = manifest.files.some(
    (entry) => entry.filename === file.filename && entry.sha256 === file.sha256,
  );
  const files = alreadyRecorded ? manifest.files : [...manifest.files, file];
  return writeManifest(taskDirectory, { ...manifest, files });
}

export function manifestFileNames(manifest: DownloadManifest): Set<string> {
  return new Set(manifest.files.map((file) => file.filename));
}