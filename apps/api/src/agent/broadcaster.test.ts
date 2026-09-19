import { describe, expect, test } from 'bun:test';
import { WebPilotError, type AgentEvent, type WebSocketMessage } from '@webpilot/schemas';
import { EventBroadcaster } from './broadcaster';

function event(taskId: string, sequence = 1): AgentEvent {
  return {
    id: `${taskId}-e${sequence}`,
    taskId,
    type: 'ACTION_COMPLETED',
    sequence,
    level: 'info',
    message: `event ${sequence}`,
    at: new Date().toISOString(),
  };
}

function recorder(): { messages: WebSocketMessage[]; send: (message: WebSocketMessage) => void } {
  const messages: WebSocketMessage[] = [];
  return { messages, send: (message) => messages.push(message) };
}

describe('EventBroadcaster', () => {
  test('only delivers events to subscribers of that task', () => {
    const broadcaster = new EventBroadcaster();
    const one = recorder();
    const two = recorder();
    broadcaster.subscribe(one.send, 'task-0001');
    broadcaster.subscribe(two.send, 'task-0002');

    expect(broadcaster.publish(event('task-0001'))).toBe(1);

    expect(one.messages).toHaveLength(1);
    expect(one.messages[0]).toMatchObject({ kind: 'event' });
    expect(two.messages).toHaveLength(0);
  });

  test('a null taskId subscribes to every task', () => {
    const broadcaster = new EventBroadcaster();
    const all = recorder();
    broadcaster.subscribe(all.send, null);

    broadcaster.publish(event('task-0001'));
    broadcaster.publish(event('task-0002'));

    expect(all.messages).toHaveLength(2);
  });

  test('hello carries the task id and a timestamp', () => {
    const broadcaster = new EventBroadcaster();
    const client = recorder();

    broadcaster.hello(client.send, 'task-0007');

    expect(client.messages[0]?.kind).toBe('hello');
    expect(client.messages[0]).toMatchObject({ taskId: 'task-0007' });
  });

  test('a throwing sender is dropped instead of breaking the fan-out', () => {
    const broadcaster = new EventBroadcaster();
    const healthy = recorder();
    let calls = 0;
    broadcaster.subscribe(() => {
      calls += 1;
      throw new Error('socket closed');
    }, 'task-0001');
    broadcaster.subscribe(healthy.send, 'task-0001');
    expect(broadcaster.count()).toBe(2);

    expect(broadcaster.publish(event('task-0001'))).toBe(1);
    expect(calls).toBe(1);
    expect(healthy.messages).toHaveLength(1);

    // The dead subscriber is gone, so the next publish does not call it again.
    expect(broadcaster.count()).toBe(1);
    broadcaster.publish(event('task-0001', 2));
    expect(calls).toBe(1);
  });

  test('unsubscribe, task snapshots, errors, pong and clear', () => {
    const broadcaster = new EventBroadcaster();
    const client = recorder();
    const off = broadcaster.subscribe(client.send, 'task-0001');

    broadcaster.publishTask('task-0001', { id: 'task-0001', status: 'running' });
    broadcaster.publishError(client.send, new WebPilotError('UNKNOWN', 'oops'));
    broadcaster.pong(client.send);

    expect(client.messages.map((message) => message.kind)).toEqual(['task', 'error', 'pong']);

    off();
    expect(broadcaster.count()).toBe(0);
    broadcaster.publish(event('task-0001', 3));
    expect(client.messages).toHaveLength(3);

    broadcaster.subscribe(client.send, 'task-0001');
    broadcaster.clear();
    expect(broadcaster.count()).toBe(0);
  });

  test('count reports per-task subscribers', () => {
    const broadcaster = new EventBroadcaster();
    broadcaster.subscribe(recorder().send, 'task-0001');
    broadcaster.subscribe(recorder().send, 'task-0001');
    broadcaster.subscribe(recorder().send, 'task-0002');

    expect(broadcaster.count()).toBe(3);
    expect(broadcaster.count('task-0001')).toBe(2);
    expect(broadcaster.count('task-9999')).toBe(0);
  });
});