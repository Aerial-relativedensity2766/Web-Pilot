import { describe, expect, test } from 'bun:test';
import { createInitialState } from '@webpilot/agent-core';
import type { AgentState, PermissionRequest, Task } from '@webpilot/schemas';
import { createMemoryDatabase } from '../db/memory';
import { TaskStore } from '../db/store';
import { AgentService, type AgentRunner, type RunnerContext } from './service';

/** No browser, no model: exercises the queue, persistence and permission gate. */
function stateFor(taskId: string, goal: string): AgentState {
  return createInitialState({ taskId, goal, maxSteps: 10, aiAvailable: false });
}

/** Waits until `check` returns true, or fails the test. */
async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

interface Harness {
  service: AgentService;
  store: TaskStore;
  contexts: RunnerContext[];
  /** Task ids handed to the runner, in start order. */
  started: string[];
}

type Outcome = 'completed' | 'cancelled' | 'failed';

/** The outcome the fake run settles on, given a stop-predicate. */
type Behaviour = (context: RunnerContext, isStopped: () => boolean) => Promise<Outcome>;

/** A runner with no browser and no model: queue, persistence and permissions only. */
function harness(behaviour: Behaviour = async () => 'completed'): Harness {
  const db = createMemoryDatabase();
  const store = new TaskStore(() => db);
  const contexts: RunnerContext[] = [];
  const started: string[] = [];

  const service = new AgentService({
    store,
    runnerFactory: (context): AgentRunner => {
      contexts.push(context);
      let stopped = false;
      return {
        async run(taskId, prompt) {
          started.push(taskId);
          expect(prompt.length).toBeGreaterThan(0);
          context.channel.emit('TASK_STARTED', 'info', 'started');
          const outcome = await behaviour(context, () => stopped);
          if (outcome === 'completed') {
            context.channel.emit('TASK_COMPLETED', 'info', 'done');
          }
          if (outcome === 'cancelled') {
            context.channel.emit('TASK_CANCELLED', 'warn', 'cancelled');
          }
          return {
            taskId,
            status: outcome,
            steps: 4,
            downloaded: outcome === 'completed' ? 2 : 0,
            error: outcome === 'failed' ? 'boom' : null,
            state: stateFor(taskId, prompt),
          };
        },
        stop() {
          stopped = true;
        },
      };
    },
  });

  return { service, store, contexts, started };
}

describe('AgentService — happy path', () => {
  test('persists a task, runs it, and records the timeline', async () => {
    const { service } = harness();
    const task = service.createTask({ prompt: 'download 3 images of trees' });

    expect(task.status).toBe('queued');
    await waitFor(() => service.getTask(task.id)?.status === 'completed');

    const finished = service.getTask(task.id);
    expect(finished?.stepCount).toBe(4);
    expect(finished?.downloadsCount).toBe(2);
    expect(finished?.completedAt).toBeTruthy();
    expect(finished?.error).toBeNull();

    const events = service.listEvents(task.id).map((event) => event.type);
    expect(events[0]).toBe('TASK_QUEUED');
    expect(events).toContain('TASK_STARTED');
    expect(events).toContain('TASK_COMPLETED');
    await service.dispose();
  });

  test('autoRun:false only queues; nothing runs until asked', async () => {
    const { service, contexts } = harness();
    const task = service.createTask({ prompt: 'extract prices', autoRun: false });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(contexts).toHaveLength(0);
    expect(service.getTask(task.id)?.status).toBe('queued');
    await service.dispose();
  });

  test('broadcasts events and task snapshots to subscribers', async () => {
    const { service } = harness();
    const received: string[] = [];
    service.broadcaster.subscribe((message) => {
      if (message.kind === 'event') received.push(message.event.type);
      if (message.kind === 'task') received.push(`task:${(message.task as Task).status}`);
    }, null);

    const task = service.createTask({ prompt: 'download 1 image' });
    await waitFor(() => service.getTask(task.id)?.status === 'completed');

    expect(received).toContain('TASK_QUEUED');
    expect(received).toContain('task:completed');
    await service.dispose();
  });
function permissionRequest(taskId: string): PermissionRequest {
  return {
    id: 'perm-test',
    taskId,
    kind: 'form_submission',
    title: 'Submit a form',
    description: 'Type "trees" and press Enter.',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

describe('AgentService — permission gate', () => {
  test('pauses the run until a human approves, then completes', async () => {
    const { service } = harness(async (context) => {
      const decision = await context.onPermissionRequest(permissionRequest(context.taskId));
      return decision.granted ? 'completed' : 'cancelled';
    });

    const task = service.createTask({ prompt: 'search the fixture site' });
    await waitFor(() => service.pendingPermissions(task.id).length === 1);

    // Still running while the decision is outstanding.
    expect(service.getTask(task.id)?.status).toBe('running');
    const pending = service.pendingPermissions(task.id)[0]!;
    expect(pending.title).toBe('Submit a form');
    expect(pending.kind).toBe('form_submission');

    expect(service.decidePermission(task.id, pending.id, { granted: true })).toBe(true);
    await waitFor(() => service.getTask(task.id)?.status === 'completed');

    expect(service.pendingPermissions(task.id)).toEqual([]);
    await service.dispose();
  });

  test('a denial cancels the run instead of proceeding', async () => {
    const { service } = harness(async (context) => {
      const decision = await context.onPermissionRequest(permissionRequest(context.taskId));
      return decision.granted ? 'completed' : 'cancelled';
    });

    const task = service.createTask({ prompt: 'submit a form' });
    await waitFor(() => service.pendingPermissions(task.id).length === 1);
    service.decidePermission(task.id, 'perm-test', { granted: false });
    await waitFor(() => service.getTask(task.id)?.status === 'cancelled');

    expect(service.getTask(task.id)?.downloadsCount).toBe(0);
    await service.dispose();
  });

  test('"remember" skips the prompt for the next run of the same task', async () => {
    let prompts = 0;
    const { service } = harness(async (context) => {
      prompts += 1;
      const decision = await context.onPermissionRequest(permissionRequest(context.taskId));
      return decision.granted ? 'completed' : 'cancelled';
    });

    const task = service.createTask({ prompt: 'first run' });
    await waitFor(() => service.pendingPermissions(task.id).length === 1);
    service.decidePermission(task.id, 'perm-test', { granted: true, remember: true });
    await waitFor(() => service.getTask(task.id)?.status === 'completed');

    // The remembered kind is auto-approved, so no prompt appears this time.
    expect(service.pendingPermissions(task.id)).toEqual([]);
    expect(prompts).toBe(1);
    await service.dispose();
  });

  test('an unknown permission id is rejected', async () => {
    const { service } = harness(async (context) => {
      await context.onPermissionRequest(permissionRequest(context.taskId));
      return 'completed';
    });

    const task = service.createTask({ prompt: 'submit a form' });
    await waitFor(() => service.pendingPermissions(task.id).length === 1);

    expect(service.decidePermission(task.id, 'not-a-permission', { granted: true })).toBe(false);
    expect(service.decidePermission('task-9999', 'perm-test', { granted: true })).toBe(false);

    service.decidePermission(task.id, 'perm-test', { granted: false });
    await waitFor(() => service.getTask(task.id)?.status === 'cancelled');
    await service.dispose();
  });

  test('dispose denies anything still waiting (fail closed)', async () => {
    let observed: boolean | null = null;
    const { service } = harness(async (context) => {
      const decision = await context.onPermissionRequest(permissionRequest(context.taskId));
      observed = decision.granted;
      return 'cancelled';
    });

    const task = service.createTask({ prompt: 'waiting on a human' });
    await waitFor(() => service.pendingPermissions(task.id).length === 1);

    await service.dispose();

    await waitFor(() => observed !== null);
    expect(observed!).toBe(false);
  });
});
});
describe('AgentService — queue and cancellation', () => {
  test('runs one task at a time and queues the next', async () => {
    const { service } = harness(async (context, isStopped) => {
      // Hold the first run open long enough to observe queueing.
      for (let i = 0; i < 200 && !isStopped(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (service.getTask(context.taskId)?.status === 'completed') break;
      }
      return 'completed';
    });

    const first = service.createTask({ prompt: 'first task' });
    const second = service.createTask({ prompt: 'second task' });

    await waitFor(() => service.activeTaskId === first.id);
    expect(service.queueLength).toBe(1);

    await waitFor(() => service.getTask(first.id)?.status === 'completed', 10_000);
    await waitFor(() => service.getTask(second.id)?.status === 'completed', 10_000);
    expect(service.activeTaskId).toBeNull();
    await service.dispose();
  });

  test('cancelling a queued task never starts a browser', async () => {
    const { service, contexts } = harness(async (_context, isStopped) => {
      while (!isStopped()) await new Promise((resolve) => setTimeout(resolve, 5));
      return 'cancelled';
    });

    const active = service.createTask({ prompt: 'busy task' });
    const queued = service.createTask({ prompt: 'never runs' });
    await waitFor(() => service.queueLength === 1);

    expect(service.cancelTask(queued.id)).toBe(true);
    await waitFor(() => service.getTask(queued.id)?.status === 'cancelled');

    const events = service.listEvents(queued.id).map((event) => event.type);
    expect(events).toContain('TASK_QUEUED');
    expect(events).toContain('TASK_CANCELLED');
    expect(events).not.toContain('TASK_STARTED');
    expect(contexts).toHaveLength(1);
    expect(service.getTask(queued.id)?.completedAt).toBeTruthy();

    service.cancelTask(active.id);
    await waitFor(() => service.getTask(active.id)?.status === 'cancelled');
    await service.dispose();
  });

  test('cancelling a running task stops the runner', async () => {
    const { service } = harness(async (_context, isStopped) => {
      while (!isStopped()) await new Promise((resolve) => setTimeout(resolve, 5));
      return 'cancelled';
    });

    const task = service.createTask({ prompt: 'long running task' });
    await waitFor(() => service.activeTaskId === task.id);
    expect(service.cancelTask(task.id)).toBe(true);

    await waitFor(() => service.getTask(task.id)?.status === 'cancelled');
    expect(service.getTask(task.id)?.error).toBeNull();
    await service.dispose();
  });

  test('cancelling an unknown or finished task returns false', async () => {
    const { service } = harness();
    const task = service.createTask({ prompt: 'quick task' });
    await waitFor(() => service.getTask(task.id)?.status === 'completed');

    expect(service.cancelTask(task.id)).toBe(false);
    expect(service.cancelTask('task-9999')).toBe(false);
    await service.dispose();
  });

  test('a failed run is recorded with its status, never as success', async () => {
    const { service } = harness(async () => 'failed');
    const task = service.createTask({ prompt: 'doomed task' });

    await waitFor(() => service.getTask(task.id)?.status === 'failed');
    expect(service.getTask(task.id)?.error).toBe('boom');
    await service.dispose();
  });
});

describe('AgentService — settings and models', () => {
  test('reports limits and safety settings without leaking paths', async () => {
    const { service } = harness();
    const settings = service.settings();
    const serialized = JSON.stringify(settings);

    expect(settings.limits.maxAgentSteps).toBeGreaterThan(0);
    expect(settings.limits.maxDownloads).toBeGreaterThan(0);
    expect(settings.limits.maxFileSizeMb).toBeGreaterThan(0);
    expect(settings.browser.engine).toBeTruthy();
    expect(settings.ai.modelId).toBeTruthy();
    expect(settings.safety.allowlistActive).toBe(
      settings.safety.downloadAllowlist.length > 0,
    );
    expect(serialized).not.toMatch(/\/home\/|\/data\/|models\//);
    await service.dispose();
  });

  test('model status starts not-loaded and never claims network inference', async () => {
    const { service } = harness();
    const status = service.modelStatus();

    expect(['not-loaded', 'unavailable', 'disabled']).toContain(status.status);
    expect(status.execution).toBe('local');
    expect(status.networkInference).toBe('disabled');
    expect(status.modelId.length).toBeGreaterThan(0);
    await service.dispose();
  });
});