/**
 * Persistence for tasks, the agent timeline and the download library.
 *
 * Every method is small and synchronous: SQLite is local and fast, and the agent
 * must never block on I/O abstractions it does not need.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  AgentEventSchema,
  type AgentEvent,
  type DownloadManifest,
  type DownloadStatus,
  type Task,
  type TaskStatus,
} from '@webpilot/schemas';
import { loggerFor, nowIso, taskIdFromSequence } from '@webpilot/shared';
import { getDb, type Database } from './client';
import { downloads, settings, taskEvents, tasks } from './schema';

const log = loggerFor('api:store');

const TASK_SEQUENCE_KEY = 'task_sequence';

export interface CreateTaskInput {
  prompt: string;
  goal?: string | null;
  status?: TaskStatus;
  id?: string;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  goal?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  stepCount?: number;
  downloadsCount?: number;
  currentUrl?: string | null;
}

export interface DownloadUpsert {
  taskId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256?: string | null;
  status: DownloadStatus;
  sourcePage?: string | null;
  alt?: string | null;
  error?: string | null;
}

/** Thin, typed wrapper over the Drizzle database. */
export class TaskStore {
  constructor(private readonly db: () => Database = getDb) {}

  /**
   * Reserves the next human-friendly task id (`task-0001`).
   *
   * The counter lives in `settings` so ids stay stable even if rows are deleted,
   * which matters because the id is also the download folder name.
   */
  nextTaskId(): string {
    const current = this.readSetting(TASK_SEQUENCE_KEY);
    const parsed = current ? Number(current) : 0;
    const next = (Number.isFinite(parsed) ? parsed : 0) + 1;
    this.writeSetting(TASK_SEQUENCE_KEY, String(next));
    return taskIdFromSequence(next);
  }

  createTask(input: CreateTaskInput): Task {
    const id = input.id ?? this.nextTaskId();
    const status = input.status ?? 'queued';
    const createdAt = nowIso();
    this.db()
      .insert(tasks)
      .values({
        id,
        prompt: input.prompt,
        goal: input.goal ?? null,
        status,
        createdAt,
        stepCount: 0,
        downloadsCount: 0,
      })
      .run();
    log.debug('task created', { taskId: id });
    return {
      id,
      prompt: input.prompt,
      goal: input.goal ?? undefined,
      status,
      createdAt,
      startedAt: null,
      completedAt: null,
      error: null,
      stepCount: 0,
      downloadsCount: 0,
      currentUrl: null,
    };
  }

  getTask(taskId: string): Task | null {
    const row = this.db().select().from(tasks).where(eq(tasks.id, taskId)).get();
    return row ? toTask(row) : null;
  }

  listTasks(limit = 50): Task[] {
    return this.db()
      .select()
      .from(tasks)
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(Math.min(Math.max(1, limit), 200))
      .all()
      .map(toTask);
  }

  updateTask(taskId: string, update: UpdateTaskInput): Task | null {
    const patch: Record<string, unknown> = {};
    if (update.status !== undefined) patch['status'] = update.status;
    if (update.goal !== undefined) patch['goal'] = update.goal;
    if (update.startedAt !== undefined) patch['startedAt'] = update.startedAt;
    if (update.completedAt !== undefined) patch['completedAt'] = update.completedAt;
    if (update.error !== undefined) patch['error'] = update.error;
    if (update.stepCount !== undefined) patch['stepCount'] = update.stepCount;
    if (update.downloadsCount !== undefined) patch['downloadsCount'] = update.downloadsCount;
    if (update.currentUrl !== undefined) patch['currentUrl'] = update.currentUrl;
    if (Object.keys(patch).length > 0) {
      this.db().update(tasks).set(patch).where(eq(tasks.id, taskId)).run();
    }
    return this.getTask(taskId);
  }

  /** Persists one agent event (idempotent on the event id). */
  appendEvent(event: AgentEvent): void {
    this.db()
      .insert(taskEvents)
      .values({
        id: event.id,
        taskId: event.taskId,
        sequence: event.sequence,
        type: event.type,
        level: event.level,
        message: event.message,
        data: event.data ? JSON.stringify(event.data) : null,
        error: event.error ? JSON.stringify(event.error) : null,
        at: event.at,
      })
      .onConflictDoNothing()
      .run();
  }

  /** Replays the timeline after `sinceSequence` (default: everything). */
  listEvents(taskId: string, sinceSequence = -1, limit = 500): AgentEvent[] {
    const rows = this.db()
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, taskId), sql`${taskEvents.sequence} > ${sinceSequence}`))
      .orderBy(taskEvents.sequence)
      .limit(Math.min(Math.max(1, limit), 2_000))
      .all();

    return rows.flatMap((row) => {
      const parsed = AgentEventSchema.safeParse({
        id: row.id,
        taskId: row.taskId,
        type: row.type,
        sequence: row.sequence,
        level: row.level,
        message: row.message,
        data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : undefined,
        error: row.error ? JSON.parse(row.error) : undefined,
        at: row.at,
      });
      if (!parsed.success) {
        log.warn('skipping unreadable event row', { id: row.id });
        return [];
      }
      return [parsed.data];
    });
  }

  countEvents(taskId: string): number {
    const row = this.db()
      .select({ value: sql<number>`count(*)` })
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .get();
    return row?.value ?? 0;
  }

  /** Inserts or refreshes a download record (keyed by task + filename). */
  upsertDownload(input: DownloadUpsert): void {
    const db = this.db();
    const existing = db
      .select({ id: downloads.id })
      .from(downloads)
      .where(and(eq(downloads.taskId, input.taskId), eq(downloads.filename, input.filename)))
      .get();

    if (existing) {
      db.update(downloads)
        .set({
          url: input.url,
          mimeType: input.mimeType,
          size: input.size,
          sha256: input.sha256 ?? null,
          status: input.status,
          sourcePage: input.sourcePage ?? null,
          alt: input.alt ?? null,
          error: input.error ?? null,
        })
        .where(eq(downloads.id, existing.id))
        .run();
      return;
    }

    db.insert(downloads)
      .values({
        id: `${input.taskId}-${input.filename}`.slice(0, 200),
        taskId: input.taskId,
        url: input.url,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        sha256: input.sha256 ?? null,
        status: input.status,
        sourcePage: input.sourcePage ?? null,
        alt: input.alt ?? null,
        error: input.error ?? null,
        createdAt: nowIso(),
      })
      .run();
  }

  listDownloads(taskId?: string, limit = 200): DownloadUpsert[] {
    const base = this.db().select().from(downloads);
    const filtered = taskId ? base.where(eq(downloads.taskId, taskId)) : base;
    return filtered
      .orderBy(desc(downloads.createdAt))
      .limit(Math.min(Math.max(1, limit), 1_000))
      .all()
      .map((row) => ({
        taskId: row.taskId,
        url: row.url,
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
        sha256: row.sha256,
        status: row.status as DownloadStatus,
        sourcePage: row.sourcePage,
        alt: row.alt,
        error: row.error,
      }));
  }

  /** Mirrors a task's `manifest.json` into the queryable download table. */
  syncManifest(taskId: string, manifest: DownloadManifest): number {
    for (const file of manifest.files) {
      this.upsertDownload({
        taskId,
        url: file.sourceUrl,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        sha256: file.sha256,
        status: 'completed',
        sourcePage: file.sourcePage ?? null,
        alt: file.alt ?? null,
      });
    }
    log.debug('manifest synced', { taskId, files: manifest.files.length });
    return manifest.files.length;
  }

  readSetting(key: string): string | null {
    const row = this.db().select().from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? null;
  }

  writeSetting(key: string, value: string): void {
    this.db()
      .insert(settings)
      .values({ key, value, updatedAt: nowIso() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: nowIso() } })
      .run();
  }
}

function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    prompt: row.prompt,
    goal: row.goal ?? undefined,
    status: row.status as TaskStatus,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error: row.error,
    stepCount: row.stepCount,
    downloadsCount: row.downloadsCount,
    currentUrl: row.currentUrl,
  };
}

export function createTaskStore(): TaskStore {
  return new TaskStore();
}