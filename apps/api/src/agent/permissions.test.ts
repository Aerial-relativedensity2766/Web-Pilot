import { describe, expect, test } from 'bun:test';
import type { PermissionRequest } from '@webpilot/schemas';
import { PermissionBroker } from './permissions';

function request(taskId: string, id: string): PermissionRequest {
  return {
    id,
    taskId,
    kind: 'form_submission',
    title: 'Submit a form',
    description: 'Type "trees" and press Enter.',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

describe('PermissionBroker', () => {
  test('resolves a pending request with the human decision', async () => {
    const broker = new PermissionBroker();
    const pending = broker.request('task-0001', request('task-0001', 'perm-1'));

    expect(broker.size).toBe(1);
    expect(broker.resolve('perm-1', { granted: true })).toBe(true);
    expect(await pending).toEqual({ granted: true });
    expect(broker.size).toBe(0);
  });

  test('a denial is reported as a denial, never as approval', async () => {
    const broker = new PermissionBroker();
    const pending = broker.request('task-0001', request('task-0001', 'perm-2'));

    broker.resolve('perm-2', { granted: false });
    expect(await pending).toEqual({ granted: false });
  });

  test('"remember" auto-approves later requests of the same kind for that task', async () => {
    const broker = new PermissionBroker();
    const first = broker.request('task-0001', request('task-0001', 'perm-3'));
    broker.resolve('perm-3', { granted: true, remember: true });
    await first;

    // No human involvement the second time.
    const second = await broker.request('task-0001', request('task-0001', 'perm-4'));
    expect(second.granted).toBe(true);
    expect(broker.size).toBe(0);
  });

  test('"remember" does not leak to other tasks', async () => {
    const broker = new PermissionBroker();
    const first = broker.request('task-0001', request('task-0001', 'perm-5'));
    broker.resolve('perm-5', { granted: true, remember: true });
    await first;

    let resolved = false;
    const other = broker.request('task-0002', request('task-0002', 'perm-6')).then((decision) => {
      resolved = true;
      return decision;
    });

    expect(resolved).toBe(false);
    broker.resolve('perm-6', { granted: false });
    expect((await other).granted).toBe(false);
  });

  test('denyAll is fail-closed and scoped by task', async () => {
    const broker = new PermissionBroker();
    const a = broker.request('task-0001', request('task-0001', 'perm-7'));
    const b = broker.request('task-0002', request('task-0002', 'perm-8'));

    expect(broker.denyAll('task-0001')).toBe(1);
    expect((await a).granted).toBe(false);

    // The other task's request is untouched and can still be approved.
    expect(broker.size).toBe(1);
    broker.resolve('perm-8', { granted: true });
    expect((await b).granted).toBe(true);
  });

  test('resolving an unknown or already-settled id returns false', async () => {
    const broker = new PermissionBroker();
    const pending = broker.request('task-0001', request('task-0001', 'perm-9'));

    expect(broker.resolve('nope', { granted: true })).toBe(false);
    expect(broker.resolve('perm-9', { granted: true })).toBe(true);
    await pending;
    expect(broker.resolve('perm-9', { granted: true })).toBe(false);
  });

  test('lists pending requests, optionally per task', async () => {
    const broker = new PermissionBroker();
    const a = broker.request('task-0001', request('task-0001', 'perm-10'));
    const b = broker.request('task-0002', request('task-0002', 'perm-11'));

    expect(broker.list().map((entry) => entry.id).sort()).toEqual(['perm-10', 'perm-11']);
    expect(broker.list('task-0002').map((entry) => entry.id)).toEqual(['perm-11']);
    expect(broker.get('task-0002', 'perm-10')).toBeNull();
    expect(broker.get('task-0001', 'perm-10')?.title).toBe('Submit a form');

    broker.denyAll();
    expect(broker.size).toBe(0);
    await a;
    await b;
  });
});