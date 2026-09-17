import { writeFile } from 'node:fs/promises';
import {
  WebPilotError,
  toWebPilotError,
  type DownloadManifest,
  type DownloadOutcome,
  type DownloadRecord,
} from '@webpilot/schemas';
import {
  downloadId,
  ensureDir,
  extensionFromUrl,
  fileNameFromUrl,
  hostnameOf,
  isAllowedHost,
  isHttpUrl,
  loggerFor,
  normalizeUrl,
  nowIso,
  safeJoin,
  safeSegment,
  sha256Hex,
  slugify,
  stripUrlCredentials,
  taskDirectory as resolveTaskDirectory,
} from '@webpilot/shared';
import { DedupeIndex } from './dedupe';
import { appendManifestFile, readManifest } from './manifest';
import { buildFilename, resolveExtension, uniqueFilename } from './naming';
import { verifyPayload, type ExpectKind } from './verify';

const log = loggerFor('downloader');
const USER_AGENT = 'WebPilot/0.1 (+local agent; respects robots and site terms)';

export interface DownloaderOptions {
  /** Root directory that holds one folder per task. */
  downloadsRoot: string;
  maxFileSizeBytes: number;
  maxFilesPerTask: number;
  /** Hosts allowed for downloads; empty means unrestricted. */
  allowlist?: readonly string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface DownloadRequest {
  taskId: string;
  goal?: string | null;
  url: string;
  /** Server supplied name, used only as a hint. */
  filename?: string;
  alt?: string;
  sourcePage?: string;
  /** Prefix for the generated filename, e.g. `tree` → `tree-001.jpg`. */
  slug?: string;
  /** 1-based position used in the generated filename. */
  index?: number;
  /** Sub directory inside the task folder. */
  targetDir?: string;
  expect?: ExpectKind;
  /** Relevance score from semantic ranking, recorded in the manifest. */
  relevance?: number;
  signal?: AbortSignal;
}

export interface DownloadResult {
  outcome: DownloadOutcome;
  manifest: DownloadManifest;
}

interface TaskContext {
  directory: string;
  manifest: DownloadManifest;
  dedupe: DedupeIndex;
  takenNames: Set<string>;
  attempts: number;
}

interface FetchedPayload {
  bytes: Uint8Array;
  declaredType: string;
  finalUrl: string;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Downloads permitted resources into `data/downloads/<taskId>/`.
 *
 * Flow: URL → request → content type → size → extension → hash → duplicate
 * check → save → manifest update. Every file is hashed so `manifest.json`
 * preserves provenance for the user.
 */
export class Downloader {
  private readonly contexts = new Map<string, TaskContext>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DownloaderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    ensureDir(options.downloadsRoot);
  }

  private contextFor(taskId: string, goal?: string | null): TaskContext {
    const existing = this.contexts.get(taskId);
    if (existing) return existing;
    const directory = resolveTaskDirectory(taskId, this.options.downloadsRoot);
    const manifest = readManifest(directory, taskId, goal ?? null);
    const context: TaskContext = {
      directory,
      manifest,
      dedupe: new DedupeIndex(directory),
      takenNames: new Set(manifest.files.map((file) => file.filename)),
      attempts: 0,
    };
    this.contexts.set(taskId, context);
    return context;
  }

  /** Loads a task context without downloading anything (used by the API). */
  loadTask(taskId: string, goal?: string | null): { directory: string; manifest: DownloadManifest } {
    const context = this.contextFor(taskId, goal);
    return { directory: context.directory, manifest: context.manifest };
  }

  private targetDirectory(context: TaskContext, targetDir?: string): string {
    if (!targetDir) return ensureDir(context.directory);
    return ensureDir(safeJoin(context.directory, safeSegment(slugify(targetDir, 'files'), 'files')));
  }

  private assertAllowed(url: string, signal?: AbortSignal): void {
    if (signal?.aborted) throw new WebPilotError('TASK_CANCELLED', 'Download cancelled');
    if (!isHttpUrl(url)) {
      throw new WebPilotError('UNSAFE_URL', `Refusing to download non-http(s) URL: ${url}`);
    }
    const host = hostnameOf(url);
    if (!isAllowedHost(host, this.options.allowlist ?? [])) {
      throw new WebPilotError('ACTION_NOT_PERMITTED', `Host not in the download allow-list: ${host}`, {
        recoverable: false,
        details: { host },
      });
    }
  }

  private async fetchPayload(url: string, signal?: AbortSignal): Promise<FetchedPayload> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const response = await this.fetchImpl(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      });

      if (!response.ok) {
        throw new WebPilotError(
          'DOWNLOAD_FAILED',
          `HTTP ${response.status} ${response.statusText} for ${stripUrlCredentials(url)}`,
          { details: { status: response.status }, recoverable: response.status >= 500 },
        );
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (declaredLength > this.options.maxFileSizeBytes) {
        throw new WebPilotError(
          'FILE_TOO_LARGE',
          `File is ${declaredLength} bytes, above the ${this.options.maxFileSizeBytes} byte limit`,
          { recoverable: false, details: { declaredLength } },
        );
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      if (response.body) {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          total += chunk.byteLength;
          if (total > this.options.maxFileSizeBytes) {
            controller.abort();
            throw new WebPilotError(
              'FILE_TOO_LARGE',
              `Download exceeded the ${this.options.maxFileSizeBytes} byte limit`,
              { recoverable: false, details: { limit: this.options.maxFileSizeBytes } },
            );
          }
          chunks.push(chunk);
        }
      } else {
        const buffer = new Uint8Array(await response.arrayBuffer());
        total = buffer.byteLength;
        chunks.push(buffer);
      }

      return {
        bytes: concatChunks(chunks, total),
        declaredType: response.headers.get('content-type') ?? '',
        finalUrl: response.url || url,
      };
    } catch (error) {
      if (error instanceof WebPilotError) throw error;
      const cause = error instanceof Error ? error.message : String(error);
      throw new WebPilotError('NETWORK_FAILED', `Could not fetch ${stripUrlCredentials(url)}: ${cause}`, {
        recoverable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private slugFor(request: DownloadRequest): string {
    if (request.slug && request.slug.trim()) return slugify(request.slug, 'download');
    if (request.alt && request.alt.trim().length > 2) return slugify(request.alt, 'download');
    const fromUrl = fileNameFromUrl(request.url, '');
    return slugify(fromUrl.replace(/\.[a-z0-9]{1,5}$/i, ''), 'download');
  }

  private static readonly FATAL_CODES = new Set([
    'ACTION_NOT_PERMITTED',
    'FILE_TOO_LARGE',
    'LIMIT_EXCEEDED',
    'TASK_CANCELLED',
    'UNSAFE_URL',
  ]);

  /** Downloads exactly one resource (URL based, no browser download dialog). */
  async download(request: DownloadRequest): Promise<DownloadResult> {
    const context = this.contextFor(request.taskId, request.goal ?? null);
    context.attempts += 1;
    const id = downloadId(request.taskId, context.attempts);
    const baseRecord = {
      id,
      taskId: request.taskId,
      url: normalizeUrl(request.url),
      sourcePage: request.sourcePage ?? null,
      alt: request.alt ?? null,
      createdAt: nowIso(),
    };

    try {
      if (context.manifest.files.length >= this.options.maxFilesPerTask) {
        throw new WebPilotError(
          'LIMIT_EXCEEDED',
          `Task already holds ${context.manifest.files.length} files (limit ${this.options.maxFilesPerTask})`,
          { recoverable: false },
        );
      }

      this.assertAllowed(request.url, request.signal);
      const payload = await this.fetchPayload(request.url, request.signal);
      const sha256 = sha256Hex(payload.bytes);
      const verification = verifyPayload({
        bytes: payload.bytes,
        declaredType: payload.declaredType,
        intendedExtension: extensionFromUrl(payload.finalUrl),
        expect: request.expect ?? 'any',
      });

      if (!verification.ok) {
        const code = verification.reason === 'empty' ? 'DOWNLOAD_FAILED' : 'MIME_MISMATCH';
        throw new WebPilotError(
          code,
          `Downloaded payload rejected (${verification.reason ?? 'unknown'}): declared ${payload.declaredType || 'nothing'}, detected ${verification.mime || 'unknown'}`,
          { details: { url: request.url, declaredType: payload.declaredType } },
        );
      }

      const duplicate = context.dedupe.find(sha256);
      if (duplicate?.persisted) {
        const record: DownloadRecord = {
          ...baseRecord,
          filename: duplicate.filename,
          mimeType: verification.mime,
          size: verification.size,
          sha256,
          status: 'skipped',
          error: 'duplicate content already stored in this task',
        };
        log.info('duplicate resource skipped', {
          taskId: request.taskId,
          filename: duplicate.filename,
        });
        return {
          outcome: {
            ok: true,
            duplicate: true,
            path: safeJoin(context.directory, duplicate.filename),
            record,
          },
          manifest: context.manifest,
        };
      }

      const extension = resolveExtension({
        sniffedExt: verification.extension,
        url: payload.finalUrl,
        hintFilename: request.filename ?? null,
      });
      const slug = this.slugFor(request);
      const filename = uniqueFilename(
        buildFilename(slug, request.index ?? context.attempts, extension),
        context.takenNames,
      );
      const directory = this.targetDirectory(context, request.targetDir);
      const path = safeJoin(directory, filename);
      await writeFile(path, payload.bytes);

      context.takenNames.add(filename);
      context.dedupe.add(sha256, filename);
      context.manifest = appendManifestFile(context.directory, context.manifest, {
        filename,
        sourceUrl: normalizeUrl(payload.finalUrl),
        mimeType: verification.mime || payload.declaredType || 'application/octet-stream',
        size: verification.size,
        sha256,
        sourcePage: request.sourcePage ?? null,
        alt: request.alt ?? null,
        ...(request.relevance !== undefined ? { relevance: request.relevance } : {}),
        downloadedAt: nowIso(),
      });

      const record: DownloadRecord = {
        ...baseRecord,
        filename,
        mimeType: verification.mime || payload.declaredType || 'application/octet-stream',
        size: verification.size,
        sha256,
        status: 'completed',
        error: null,
      };

      log.info('download completed', {
        taskId: request.taskId,
        filename,
        size: verification.size,
        mimeType: record.mimeType,
      });

      return { outcome: { ok: true, path, record }, manifest: context.manifest };
    } catch (error) {
      const wpError = toWebPilotError(error, 'DOWNLOAD_FAILED');
      log.warn('download failed', {
        taskId: request.taskId,
        url: stripUrlCredentials(request.url),
        code: wpError.code,
        message: wpError.message,
      });

      const record: DownloadRecord = {
        ...baseRecord,
        filename: request.filename ? safeSegment(request.filename, 'download') : '',
        mimeType: '',
        size: 0,
        sha256: null,
        status: 'failed',
        error: `${wpError.code}: ${wpError.message}`,
      };

      // Structural failures (allow-list, size limit, cancellation) are thrown so
      // the agent loop can replan or stop; per-resource failures are returned so
      // the loop can simply try the next candidate.
      if (Downloader.FATAL_CODES.has(wpError.code) || !wpError.recoverable) throw wpError;
      return { outcome: { ok: false, record, path: null }, manifest: context.manifest };
    }
  }

  /**
   * Downloads a ranked list of candidates, stopping once `count` new files are
   * stored. Duplicates do not count towards the target, and individual failures
   * never abort the batch.
   */
  async downloadMany(
    requests: readonly DownloadRequest[],
    options: { count: number; taskId: string; goal?: string | null },
  ): Promise<{
    results: DownloadResult[];
    manifest: DownloadManifest;
    completed: number;
    failed: number;
    duplicates: number;
  }> {
    const results: DownloadResult[] = [];
    let completed = 0;
    let failed = 0;
    let duplicates = 0;

    for (const request of requests) {
      if (completed >= options.count) break;
      try {
        const result = await this.download({
          ...request,
          taskId: options.taskId,
          goal: options.goal,
        });
        results.push(result);
        if (result.outcome.duplicate) duplicates += 1;
        else if (result.outcome.ok) completed += 1;
        else failed += 1;
      } catch (error) {
        const wpError = toWebPilotError(error, 'DOWNLOAD_FAILED');
        if (Downloader.FATAL_CODES.has(wpError.code)) throw wpError;
        failed += 1;
      }
    }

    const context = this.contextFor(options.taskId, options.goal ?? null);
    return { results, manifest: context.manifest, completed, failed, duplicates };
  }

  /** Current manifest for a task (reads from disk when not cached). */
  getManifest(taskId: string, goal?: string | null): DownloadManifest {
    return this.contextFor(taskId, goal ?? null).manifest;
  }

  /** Number of files already stored for a task. */
  count(taskId: string): number {
    return this.contextFor(taskId).manifest.files.length;
  }
}