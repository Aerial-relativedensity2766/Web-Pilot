import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { config, findRepoRoot } from './config';
import { WebPilotError } from '@webpilot/schemas';

export function repoRoot(): string {
  return config.repoRoot || findRepoRoot();
}

export function resolveFromRoot(...segments: string[]): string {
  return path.resolve(repoRoot(), ...segments);
}

/** Creates the directory (recursively) and returns it. */
export function ensureDir(directory: string): string {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * Joins path segments while refusing to escape `base`.
 * Guards every task-controlled path (task ids, sub directories, filenames).
 */
export function safeJoin(base: string, ...segments: string[]): string {
  const root = path.resolve(base);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new WebPilotError('UNSAFE_URL', `Refusing to write outside ${root}`, {
      details: { base: root, target },
    });
  }
  return target;
}

/** Sanitises a single path segment so it can never contain separators. */
export function safeSegment(value: string, fallback = 'item'): string {
  const cleaned = value
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\.{2,}/g, '.')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : fallback;
}

export function taskDirectory(taskId: string, downloadsRoot = config.downloadsDir): string {
  return ensureDir(safeJoin(downloadsRoot, safeSegment(taskId, 'task')));
}

export function manifestPath(taskDir: string): string {
  return safeJoin(taskDir, 'manifest.json');
}

export function screenshotDirectory(taskId: string): string {
  return ensureDir(safeJoin(config.screenshotsDir, safeSegment(taskId, 'task')));
}

export function sessionDirectory(taskId: string): string {
  return ensureDir(safeJoin(config.sessionsDir, safeSegment(taskId, 'task')));
}

export function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function directoryExists(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/** Lists file names (not directories) directly inside `directory`. */
export function listFiles(directory: string): string[] {
  if (!directoryExists(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}