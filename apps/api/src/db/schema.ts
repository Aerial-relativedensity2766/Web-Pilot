/**
 * SQLite schema (Drizzle) for the local task history and download library.
 *
 * Design notes:
 *  - Everything lives in one local file (`WEBPILOT_DB_URL`, default
 *    `./data/webpilot.db`). No cloud, no migrations against a remote server.
 *  - Timestamps are ISO-8601 **text**: they match `nowIso()` in `@webpilot/shared`
 *    and the `z.string()` timestamps already used by `@webpilot/schemas`.
 *  - Column names are snake_case; the TypeScript keys stay camelCase.
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * One row per natural-language task. Mirrors `TaskSchema` in `@webpilot/schemas`
 * (the API serialises these rows straight into that contract).
 */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  goal: text('goal'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  error: text('error'),
  stepCount: integer('step_count').notNull().default(0),
  downloadsCount: integer('downloads_count').notNull().default(0),
  currentUrl: text('current_url'),
});

/**
 * The persisted agent timeline. `sequence` is monotonic per task, so a client
 * that reconnects can replay everything it missed in the right order.
 */
export const taskEvents = sqliteTable(
  'task_events',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    level: text('level').notNull(),
    message: text('message').notNull(),
    /** JSON encoded `data` payload (never raw HTML). */
    data: text('data'),
    /** JSON encoded `WebPilotError`, when the event carries one. */
    error: text('error'),
    at: text('at').notNull(),
  },
  (table) => [index('task_events_task_sequence_idx').on(table.taskId, table.sequence)],
);

/**
 * One row per downloaded (or failed) file. This is the queryable index of the
 * local library; `manifest.json` inside each task folder stays the source of
 * truth for provenance.
 */
export const downloads = sqliteTable(
  'downloads',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    url: text('url').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull().default(0),
    sha256: text('sha256'),
    status: text('status').notNull(),
    sourcePage: text('source_page'),
    alt: text('alt'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('downloads_task_idx').on(table.taskId)],
);

/**
 * Small key/value store for local settings the user changes at runtime
 * (for example the task id sequence). Environment variables remain the
 * primary configuration source — see `packages/shared/src/config.ts`.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type TaskRow = typeof tasks.$inferSelect;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type DownloadRow = typeof downloads.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;