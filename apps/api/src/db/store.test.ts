import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@webpilot/schemas';
import { createMemoryDatabase } from './memory';
import type { Database as DrizzleDatabase } from './client';
import { TaskStore } from './store';

function store(): TaskStore {
  const db: DrizzleDatabase = createMemoryDatabase();
  return new TaskStore(() => db);
}

function agentEvent(taskId: string, sequence: number): AgentEvent {
  return {
    id: `${taskId}-e${String(sequence).padStart(5, '0')}`,
    taskId,
    type: 'ACTION_COMPLETED',
    sequence,
    level: 'info',
    message: `step ${sequence}`,
    data: { sequence },
    at: new Date().toISOString(),
  };
}

describe('TaskStore — tasks', () => {
  test('assigns sequential human-friendly ids and starts queued', () => {
    const tasks = store();
    const first = tasks.createTask({ prompt: 'download 3 images of trees' });
    const second = tasks.createTask({ prompt: 'extract prices' });

    expect(first.id).toBe('task-0001');
    expect(second.id).toBe('task-0002');
    expect(first.status).toBe('queued');
    expect(first.stepCount).toBe(0);
    expect(first.downloadsCount).toBe(0);
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
  });

  test('ids survive task rotation because the counter is persisted', () => {
    const database = createMemoryDatabase();
    const tasks = new TaskStore(() => database);

    const created = tasks.createTask({ prompt: 'first' });
    tasks.updateTask(created.id, { status: 'cancelled' });
    const next = tasks.createTask({ prompt: 'second' });

    expect(next.id).toBe('task-0002');
    expect(tasks.readSetting('task_sequence')).toBe('2');
  });

  test('updates task state and lists newest first', () => {
    const tasks = store();
    const first = tasks.createTask({ prompt: 'one' });
    const second = tasks.createTask({ prompt: 'two' });

    tasks.updateTask(first.id, {
      status: 'completed',
      stepCount: 4,
      downloadsCount: 2,
      currentUrl: 'http://127.0.0.1:3001/test-site/search?q=trees',
      completedAt: new Date().toISOString(),
      error: null,
    });

    const updated = tasks.getTask(first.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.stepCount).toBe(4);
    expect(updated?.downloadsCount).toBe(2);
    expect(updated?.currentUrl).toContain('q=trees');

    const listed = tasks.listTasks();
    expect(listed.map((task) => task.id)).toEqual([second.id, first.id]);
  });

  test('getTask returns null for an unknown id', () => {
    expect(store().getTask('task-9999')).toBeNull();
  });
});

describe('TaskStore — events', () => {
  test('persists events and replays them in sequence order', () => {
    const tasks = store();
    const task = tasks.createTask({ prompt: 'run' });

    tasks.appendEvent(agentEvent(task.id, 1));
    tasks.appendEvent(agentEvent(task.id, 2));
    tasks.appendEvent(agentEvent(task.id, 3));

    const events = tasks.listEvents(task.id);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events[0]?.data).toEqual({ sequence: 1 });
    expect(tasks.countEvents(task.id)).toBe(3);
  });

  test('since filters strictly newer events (reconnect semantics)', () => {
    const tasks = store();
    const task = tasks.createTask({ prompt: 'run' });
    for (const sequence of [1, 2, 3, 4]) tasks.appendEvent(agentEvent(task.id, sequence));

    expect(tasks.listEvents(task.id, 2).map((event) => event.sequence)).toEqual([3, 4]);
    expect(tasks.listEvents(task.id, 4)).toEqual([]);
  });

  test('appending the same event id twice is a no-op', () => {
    const tasks = store();
    const task = tasks.createTask({ prompt: 'run' });

    tasks.appendEvent(agentEvent(task.id, 1));
    tasks.appendEvent(agentEvent(task.id, 1));

    expect(tasks.countEvents(task.id)).toBe(1);
  });

  test('events of other tasks never leak into a replay', () => {
    const tasks = store();
    const first = tasks.createTask({ prompt: 'one' });
    const second = tasks.createTask({ prompt: 'two' });

    tasks.appendEvent(agentEvent(first.id, 1));
    tasks.appendEvent(agentEvent(second.id, 2));

    expect(tasks.listEvents(first.id).map((event) => event.id)).toEqual([`${first.id}-e00001`]);
  });
});

describe('TaskStore — downloads', () => {
  test('upserts by task + filename instead of duplicating rows', () => {
    const tasks = store();
    const task = tasks.createTask({ prompt: 'download' });

    tasks.upsertDownload({
      taskId: task.id,
      url: 'http://127.0.0.1:3001/test-site/images/birch-grove.png',
      filename: 'trees-image-001.png',
      mimeType: 'image/png',
      size: 8_767,
      sha256: 'a'.repeat(64),
      status: 'completed',
      sourcePage: 'http://127.0.0.1:3001/test-site/search?q=trees',
      alt: 'birch trees grove',
    });
    tasks.upsertDownload({
      taskId: task.id,
      url: 'http://127.0.0.1:3001/test-site/images/birch-grove.png',
      filename: 'trees-image-001.png',
      mimeType: 'image/png',
      size: 8_767,
      sha256: 'b'.repeat(64),
      status: 'completed',
    });

    const downloads = tasks.listDownloads(task.id);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.sha256).toBe('b'.repeat(64));
  });

  test('records rejected downloads with their reason', () => {
    const tasks = store();
    const task = tasks.createTask({ prompt: 'download' });

    tasks.upsertDownload({
      taskId: task.id,
      url: 'http://127.0.0.1:3001/test-site/images/mislabeled.jpg',
      filename: 'mislabeled.jpg',
      mimeType: 'text/html',
      size: 512,
      status: 'failed',
      error: 'Downloaded payload rejected (not_expected_kind)',
    });

    const downloads = tasks.listDownloads(task.id);
    expect(downloads[0]?.status).toBe('failed');
    expect(downloads[0]?.error).toContain('not_expected_kind');
  });

  test('syncManifest mirrors manifest.json into the library table', () => {
    const tasks = store();
    const task = tasks.createTask({ prompt: 'download' });
    const downloadedAt = new Date().toISOString();

    expect(
      tasks.syncManifest(task.id, {
        taskId: task.id,
        goal: 'download 2 images',
        createdAt: downloadedAt,
        files: [
          {
            filename: 'trees-image-001.png',
            sourceUrl: 'http://127.0.0.1:3001/test-site/images/birch-grove.png',
            mimeType: 'image/png',
            size: 8_767,
            sha256: 'c'.repeat(64),
            sourcePage: 'http://127.0.0.1:3001/test-site/search?q=trees',
            alt: 'birch trees grove',
            downloadedAt,
          },
          {
            filename: 'trees-image-002.png',
            sourceUrl: 'http://127.0.0.1:3001/test-site/images/pine-forest.png',
            mimeType: 'image/png',
            size: 18_685,
            sha256: 'd'.repeat(64),
            downloadedAt,
          },
        ],
        totals: { files: 2, bytes: 27_452 },
      }),
    ).toBe(2);

    const downloads = tasks.listDownloads(task.id);
    expect(downloads).toHaveLength(2);
    expect(downloads.every((entry) => entry.status === 'completed')).toBe(true);
    expect(downloads.every((entry) => entry.mimeType === 'image/png')).toBe(true);
  });

  test('listDownloads without a taskId returns the whole library', () => {
    const tasks = store();
    const first = tasks.createTask({ prompt: 'one' });
    const second = tasks.createTask({ prompt: 'two' });

    for (const [task, filename] of [
      [first, 'a.png'],
      [second, 'b.png'],
    ] as const) {
      tasks.upsertDownload({
        taskId: task.id,
        url: 'http://127.0.0.1:3001/test-site/images/a.png',
        filename,
        mimeType: 'image/png',
        size: 10,
        status: 'completed',
      });
    }

    expect(tasks.listDownloads()).toHaveLength(2);
        expect(tasks.listDownloads(second.id)).toHaveLength(1);
  });
});