import { defineConfig } from 'drizzle-kit';
import { config } from '@webpilot/shared';

/**
 * Drizzle Kit configuration for WebPilot's local SQLite database.
 *
 * Run from the repo root (where this file lives):
 *   bun run db:generate   # write SQL migrations into apps/api/drizzle
 *   bun run db:studio     # inspect the local database
 *
 * The database URL comes from the same `WEBPILOT_DB_URL` the API uses at
 * runtime, so generated migrations always target the file the API opens.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './apps/api/src/db/schema.ts',
  out: './apps/api/drizzle',
  dbCredentials: {
    url: config.dbUrl,
  },
  strict: true,
  verbose: true,
});