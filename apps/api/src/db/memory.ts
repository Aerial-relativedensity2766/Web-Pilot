/**
 * Test-only helper: an in-memory SQLite database migrated with the real
 * migration files.
 *
 * Tests must never open the user's `data/webpilot.db`, so stores under test get
 * an explicit connection instead of going through `getDb()`.
 */
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { MIGRATIONS_DIR, type Database as DrizzleDatabase } from './client';
import * as schema from './schema';

export function createMemoryDatabase(): DrizzleDatabase {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}