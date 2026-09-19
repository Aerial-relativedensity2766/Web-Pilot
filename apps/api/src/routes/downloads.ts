/**
 * The local download library.
 *
 * Reads `manifest.json` from `data/downloads/<taskId>/` (already written by
 * `download-core`) and serves files back to the dashboard **without ever
 * leaving the task folder**: every segment goes through `safeJoin`.
 */
import { Elysia } from 'elysia';
import { existsSync } from 'node:fs';
import { readManifest } from '@webpilot/download-core';
import { config, fileExists, listFiles, safeJoin, safeSegment, taskDirectory } from '@webpilot/shared';
import type { AgentService } from '../agent/service';

function notFound(message: string): { error: { code: string; message: string } } {
  return { error: { code: 'NOT_FOUND', message } };
}

function manifestFor(taskId: string, goal: string | null = null) {
  try {
    return readManifest(taskDirectory(taskId, config.downloadsDir), taskId, goal);
  } catch {
    return null;
  }
}

export function downloadRoutes(service: AgentService) {
  return new Elysia({ name: 'webpilot-downloads', prefix: '/downloads' })
    /** Indexed download records (queryable view of the library). */
    .get('/', ({ query }) => {
      const taskId = typeof query['taskId'] === 'string' ? query['taskId'] : undefined;
      const limit = Number(query['limit'] ?? 200);
      return {
        downloads: service.listDownloads(taskId, Number.isFinite(limit) ? limit : 200),
      };
    })

    /** The provenance manifest for one task, straight from disk. */
    .get('/:taskId', ({ params, set }) => {
      const manifest = manifestFor(params.taskId);
      if (!manifest) {
        set.status = 404;
        return notFound(`No manifest for task ${params.taskId}`);
      }
      return { manifest };
    })

    /**
     * Streams one downloaded file. `:filename+` allows sub directories created by
     * a `targetDir` download, while `safeJoin` still refuses any path that would
     * escape the task folder.
     */
    .get('/:taskId/files/:filename', ({ params, set }) => {
      const taskDirectoryPath = taskDirectory(params.taskId, config.downloadsDir);
      if (!existsSync(taskDirectoryPath)) {
        set.status = 404;
        return notFound(`No download folder for task ${params.taskId}`);
      }

      let target: string;
      try {
        const segments = params.filename.split('/').map((part) => safeSegment(part, 'file'));
        target = safeJoin(taskDirectoryPath, ...segments);
      } catch {
        set.status = 400;
        return notFound('Refusing to serve a path outside the task folder');
      }

      if (!fileExists(target)) {
        set.status = 404;
        return notFound(`No such file: ${params.filename}`);
      }

      const manifest = manifestFor(params.taskId);
      const record = manifest?.files.find((file) => file.filename === params.filename);
      return new Response(Bun.file(target), {
        headers: {
          'content-type': record?.mimeType ?? 'application/octet-stream',
          // Provenance is part of the payload: the user can verify what they got.
          'x-webpilot-sha256': record?.sha256 ?? '',
          'x-webpilot-source': record?.sourceUrl ?? '',
        },
      });
    })

    /** Files actually present on disk for a task (audit vs. the manifest). */
    .get('/:taskId/files', ({ params, set }) => {
      const taskDirectoryPath = taskDirectory(params.taskId, config.downloadsDir);
      if (!existsSync(taskDirectoryPath)) {
        set.status = 404;
        return notFound(`No download folder for task ${params.taskId}`);
      }
      return {
        taskId: params.taskId,
        files: listFiles(taskDirectoryPath).filter((name) => name !== 'manifest.json' && !name.startsWith('.')),
        manifest: manifestFor(params.taskId),
      };
    });
}