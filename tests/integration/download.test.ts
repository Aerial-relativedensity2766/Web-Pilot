import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Downloader } from '@webpilot/download-core';
import { DownloadManifestSchema } from '@webpilot/schemas';
import { ensureTestSiteRunning, siteUrl } from './support';

/**
 * Integration: extractor → downloader.
 * Downloads go through the real HTTP stack against the fixture site, which
 * serves genuine PNG bytes (so magic-number sniffing is exercised).
 */

let downloadsRoot: string;

beforeAll(async () => {
  await ensureTestSiteRunning();
  downloadsRoot = mkdtempSync(path.join(tmpdir(), 'webpilot-downloads-'));
});

afterAll(() => {
  rmSync(downloadsRoot, { recursive: true, force: true });
});

function createDownloader(overrides: Partial<ConstructorParameters<typeof Downloader>[0]> = {}) {
  return new Downloader({
    downloadsRoot,
    maxFileSizeBytes: 2 * 1_024 * 1_024,
    maxFilesPerTask: 25,
    allowlist: ['127.0.0.1', 'localhost'],
    ...overrides,
  });
}

const TREE_URLS = [
  siteUrl('images/oak-tree-meadow.png?w=960&h=640'),
  siteUrl('images/pine-forest.png?w=900&h=600'),
  siteUrl('images/treehouse-woods.png?w=880&h=660'),
];

describe('Downloader', () => {
  it('downloads files, verifies bytes, hashes them and writes a manifest', async () => {
    const downloader = createDownloader();
    const result = await downloader.download({
      taskId: 'task-0001',
      goal: 'Download tree images',
      url: TREE_URLS[0]!,
      slug: 'tree',
      index: 1,
      alt: 'large green oak tree standing in a meadow',
      expect: 'image',
    });

    expect(result.outcome.ok).toBe(true);
    expect(result.outcome.record.filename).toBe('tree-001.png');
    expect(result.outcome.record.mimeType).toBe('image/png');
    expect(result.outcome.record.size).toBeGreaterThan(1_000);
    expect(result.outcome.record.sha256).toMatch(/^[0-9a-f]{64}$/);

    const taskDir = path.join(downloadsRoot, 'task-0001');
    const files = readdirSync(taskDir).filter((file) => file.endsWith('.png'));
    expect(files).toEqual(['tree-001.png']);

    const manifest = DownloadManifestSchema.parse(
      JSON.parse(readFileSync(path.join(taskDir, 'manifest.json'), 'utf8')),
    );
    expect(manifest.totals.files).toBe(1);
    expect(manifest.files[0]?.sourceUrl).toContain('oak-tree-meadow');
    expect(manifest.files[0]?.sha256).toBe(result.outcome.record.sha256 ?? '');
    expect(manifest.goal).toBe('Download tree images');
  });

  it('detects duplicates by content hash instead of rewriting the file', async () => {
    const downloader = createDownloader();
    const first = await downloader.download({ taskId: 'task-0002', url: TREE_URLS[0]!, slug: 'tree', index: 1 });
    const second = await downloader.download({ taskId: 'task-0002', url: TREE_URLS[0]!, slug: 'tree', index: 2 });

    expect(first.outcome.ok).toBe(true);
    expect(second.outcome.duplicate).toBe(true);
    expect(second.outcome.record.status).toBe('skipped');
    expect(downloader.count('task-0002')).toBe(1);
  });

  it('downloads a batch and stops at the requested count', async () => {
    const downloader = createDownloader();
    const requests = [0, 1, 2, 0].map((index) => ({
      taskId: 'task-0003',
      url: TREE_URLS[index]!,
      slug: 'tree',
      index: index + 1,
      expect: 'image' as const,
    }));

    const batch = await downloader.downloadMany(requests, { count: 3, taskId: 'task-0003' });
    expect(batch.completed).toBe(3);
    expect(batch.duplicates).toBeGreaterThanOrEqual(0);
    expect(batch.manifest.files.length).toBe(3);
    const names = batch.manifest.files.map((file) => file.filename);
    expect(names[0]).toBe('tree-001.png');
  });

  it('rejects an image URL that actually serves HTML', async () => {
    const downloader = createDownloader();
    const result = await downloader.download({
      taskId: 'task-0004',
      url: siteUrl('images/mislabeled.jpg'),
      slug: 'broken',
      expect: 'image',
    });

    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.record.status).toBe('failed');
    expect(result.outcome.record.error).toContain('MIME_MISMATCH');
  });

  it('enforces the maximum file size', async () => {
    const downloader = createDownloader({ maxFileSizeBytes: 512 * 1_024 });
    await expect(
      downloader.download({ taskId: 'task-0005', url: siteUrl('images/oversized.png') }),
    ).rejects.toThrow(/FILE_TOO_LARGE|above the/);
  });

  it('refuses hosts outside the allow-list', async () => {
    const downloader = createDownloader({ allowlist: ['example.com'] });
    await expect(
      downloader.download({ taskId: 'task-0006', url: TREE_URLS[0]! }),
    ).rejects.toThrow(/allow-list/);
  });

  it('rejects non-http(s) URLs', async () => {
    const downloader = createDownloader();
    await expect(
      downloader.download({ taskId: 'task-0007', url: 'file:///etc/passwd' }),
    ).rejects.toThrow(/non-http/);
  });

  it('honours maxFilesPerTask', async () => {
    const downloader = createDownloader({ maxFilesPerTask: 1 });
    await downloader.download({ taskId: 'task-0008', url: TREE_URLS[0]!, slug: 'tree', index: 1 });
    await expect(
      downloader.download({ taskId: 'task-0008', url: TREE_URLS[1]!, slug: 'tree', index: 2 }),
    ).rejects.toThrow(/limit/);
  });
});
