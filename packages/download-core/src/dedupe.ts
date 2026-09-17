import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { safeJoin } from '@webpilot/shared';

interface DedupeState {
  version: 1;
  /** sha256 → stored filename */
  hashes: Record<string, string>;
}

export interface DuplicateHit {
  sha256: string;
  filename: string;
  /** true when the duplicate came from a previous run (persisted index) */
  persisted: boolean;
}

/**
 * Content-addressed duplicate detection.
 *
 * The same image is frequently offered by several URLs on the same page; hashing
 * the bytes keeps `downloads/task-0001` free of copies while still recording the
 * provenance of every source URL in the manifest.
 */
export class DedupeIndex {
  private readonly state: DedupeState;
  private readonly indexFile: string;

  constructor(private readonly taskDirectory: string) {
    this.indexFile = safeJoin(taskDirectory, '.dedupe.json');
    this.state = this.load();
  }

  private load(): DedupeState {
    if (!existsSync(this.indexFile)) return { version: 1, hashes: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, 'utf8')) as DedupeState;
      if (parsed && typeof parsed.hashes === 'object' && parsed.hashes !== null) return parsed;
    } catch {
      // corrupted index: start fresh rather than failing the task
    }
    return { version: 1, hashes: {} };
  }

  /** Returns a hit when the hash was already stored in this task folder. */
  find(sha256: string): DuplicateHit | null {
    const filename = this.state.hashes[sha256];
    if (!filename) return null;
    return {
      sha256,
      filename,
      persisted: existsSync(safeJoin(this.taskDirectory, filename)),
    };
  }

  add(sha256: string, filename: string): void {
    this.state.hashes[sha256] = filename;
    this.persist();
  }

  has(sha256: string): boolean {
    return Boolean(this.state.hashes[sha256]);
  }

  get size(): number {
    return Object.keys(this.state.hashes).length;
  }

  entries(): Array<[string, string]> {
    return Object.entries(this.state.hashes);
  }

  private persist(): void {
    try {
      writeFileSync(this.indexFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      // the index is an optimisation — never fail a download because of it
    }
  }
}