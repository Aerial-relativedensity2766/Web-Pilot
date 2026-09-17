/**
 * Identifier helpers.
 *
 * Task ids are human friendly and sequential (`task-0001`) because they double
 * as the download directory name; everything else is a short random id so two
 * WebPilot instances never collide.
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return out;
}

export function randomUuid(): string {
  return crypto.randomUUID();
}

/** `1` → `task-0001` */
export function taskIdFromSequence(sequence: number): string {
  const safe = Math.max(1, Math.trunc(sequence));
  return `task-${String(safe).padStart(4, '0')}`;
}

/** Parses the numeric part of a `task-000N` id, or `0` when not sequential. */
export function sequenceFromTaskId(taskId: string): number {
  const match = /^task-(\d+)$/.exec(taskId);
  return match?.[1] ? Number(match[1]) : 0;
}

export function actionId(taskId: string, sequence: number): string {
  return `${taskId}-a${String(sequence).padStart(4, '0')}`;
}

export function downloadId(taskId: string, sequence: number): string {
  return `${taskId}-d${String(sequence).padStart(4, '0')}`;
}

export function eventId(taskId: string, sequence: number): string {
  return `${taskId}-e${String(sequence).padStart(5, '0')}`;
}

export function permissionId(): string {
  return `perm-${randomId(10)}`;
}

export function sessionId(): string {
  return `session-${randomId(10)}`;
}