import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@webpilot/schemas';
import { TaskChannel, createTaskChannel } from './channel';

function collect(channel: TaskChannel): AgentEvent[] {
  const events: AgentEvent[] = [];
  channel.subscribe((event) => events.push(event));
  return events;
}

describe('TaskChannel', () => {
  test('numbers events monotonically from 1 and stamps id/task/at', () => {
    const channel = createTaskChannel('task-0001');
    const events = collect(channel);

    channel.emit('TASK_QUEUED', 'info', 'queued');
    channel.emit('TASK_STARTED', 'info', 'started');

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[0]?.id).toBe('task-0001-e00001');
    expect(events[1]?.id).toBe('task-0001-e00002');
    expect(events.every((event) => event.taskId === 'task-0001')).toBe(true);
    expect(Number.isNaN(Date.parse(events[0]!.at))).toBe(false);
    expect(channel.lastSequence).toBe(2);
  });

  test('re-sequences engine events instead of trusting their counter', () => {
    const channel = createTaskChannel('task-0002');
    const events = collect(channel);

    // The engine numbers its own events; the API must own the final sequence.
    channel.accept({
      id: 'engine-1',
      taskId: 'task-0002',
      type: 'ACTION_COMPLETED',
      sequence: 99,
      level: 'info',
      message: 'engine step',
      at: new Date().toISOString(),
    });
    channel.emit('BROWSER_STATUS', 'info', 'browser ready');

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[0]?.id).toBe('task-0002-e00001');
    expect(events[0]?.type).toBe('ACTION_COMPLETED');
  });

  test('forwards events to the persistence sink', () => {
    const persisted: AgentEvent[] = [];
    const channel = createTaskChannel('task-0003', (event) => persisted.push(event));

    channel.emit('TASK_COMPLETED', 'info', 'done');

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.message).toBe('done');
  });

  test('keeps other subscribers alive when one throws', () => {
    const channel = createTaskChannel('task-0004');
    const received: AgentEvent[] = [];
    channel.subscribe(() => {
      throw new Error('dead socket');
    });
    channel.subscribe((event) => received.push(event));

    expect(() => channel.emit('LOG', 'info', 'still delivered')).not.toThrow();
    expect(received).toHaveLength(1);
  });

  test('unsubscribe stops delivery', () => {
    const channel = createTaskChannel('task-0005');
    const received: AgentEvent[] = [];
    const off = channel.subscribe((event) => received.push(event));

    channel.emit('LOG', 'info', 'first');
    off();
    channel.emit('LOG', 'info', 'second');

    expect(received).toHaveLength(1);
  });

  test('carries data and error payloads through unchanged', () => {
    const channel = createTaskChannel('task-0006');
    const events = collect(channel);

    channel.emit('ACTION_FAILED', 'error', 'boom', { attempt: 2 }, {
      code: 'ACTION_TIMEOUT',
      message: 'timed out',
      recoverable: true,
    });

    expect(events[0]?.data).toEqual({ attempt: 2 });
    expect(events[0]?.error?.code).toBe('ACTION_TIMEOUT');
    expect(events[0]?.level).toBe('error');
  });
});