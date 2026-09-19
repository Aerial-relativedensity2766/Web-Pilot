/**
 * AgentService — the piece that turns a natural-language prompt into a real run.
 *
 * It owns everything the request layer must not know about:
 *  - the **queue** (one browser at a time keeps resource use predictable)
 *  - **engine construction** (`BrowserManager` → `BrowserController` →
 *    `Downloader` → `AgentEngine`) with the configured limits applied
 *  - the **event channel** that persists and broadcasts every step
 *  - the **permission gate** that pauses sensitive actions for a human decision
 *  - **persistence** of tasks, timeline and the download library
 *
 * All AI is optional: with `WEBPILOT_AI_ENABLED=true` the local model is tried
 * first and the deterministic rule planner takes over when weights are absent,
 * so a run always produces a valid plan.
 */
import {
  AgentEngine,
  type AgentRunResult,
  type PermissionDecision,
} from '@webpilot/agent-core';
import {
  EmbeddingManager,
  ModelManager,
  type ModelInfo,
} from '@webpilot/ai-core';
import { BrowserController, BrowserManager } from '@webpilot/browser-core';
import { Downloader, readManifest } from '@webpilot/download-core';
import {
  toWebPilotError,
  type AgentEvent,
  type CreateTaskRequest,
  type PermissionRequest,
  type Task,
  type TaskStatus,
} from '@webpilot/schemas';
import {
  CancellationToken,
  config,
  createEventBus,
  loggerFor,
  nowIso,
  taskDirectory,
  type EventBus,
} from '@webpilot/shared';
import { EventBroadcaster, createEventBroadcaster } from './broadcaster';
import { TaskChannel, createTaskChannel } from './channel';
import { PermissionBroker } from './permissions';
import { createTaskStore, type TaskStore } from '../db/store';

const log = loggerFor('api:agent');

/** Everything a runner needs, injected so tests can supply a fake. */
export interface RunnerContext {
  taskId: string;
  prompt: string;
  channel: TaskChannel;
  onPermissionRequest: (request: PermissionRequest) => Promise<PermissionDecision>;
  onBrowserStatus: (status: string, detail?: Record<string, unknown>) => void;
  modelManager: ModelManager;
  embeddingManager: EmbeddingManager;
}

/** The minimal surface `AgentService` needs from an agent run. */
export interface AgentRunner {
  run(taskId: string, prompt: string, signal: CancellationToken): Promise<AgentRunResult>;
  stop(): void;
}

export type RunnerFactory = (context: RunnerContext) => AgentRunner;

/**
 * Builds the real engine: Playwright browser, deterministic controller, safe
 * downloader and the local (or rule-based) planner.
 */
export function createDefaultRunner(context: RunnerContext): AgentRunner {
  const browserManager = new BrowserManager({
    engine: config.browser.engine,
    headless: config.browser.headless,
    maxTabs: config.browser.maxTabs,
    navigationTimeoutMs: config.browser.navigationTimeoutMs,
    actionTimeoutMs: config.browser.actionTimeoutMs,
    contextName: config.browser.contextName,
    onStatusChange: (status, detail) => context.onBrowserStatus(status, detail),
  });

  const controller = new BrowserController({
    manager: browserManager,
    actionTimeoutMs: config.browser.actionTimeoutMs,
  });

  const downloader = new Downloader({
    downloadsRoot: config.downloadsDir,
    maxFileSizeBytes: config.limits.maxFileSizeBytes,
    maxFilesPerTask: config.limits.maxDownloads,
    allowlist: config.safety.downloadAllowlist,
  });

  // Engine events are re-sequenced into the task channel before leaving this
  // scope, so the persisted timeline is monotonic and gap free.
  const bus: EventBus<AgentEvent> = createEventBus<AgentEvent>();
  bus.on((event) => {
    context.channel.accept(event);
  });

  const engine = new AgentEngine({
    browserManager,
    controller,
    downloader,
    modelManager: context.modelManager,
    embeddingManager: context.embeddingManager,
    eventBus: bus,
    onPermissionRequest: context.onPermissionRequest,
  });

  return {
    run: (taskId, prompt, signal) => engine.run(taskId, prompt, signal),
    stop: () => engine.stop(),
  };
}

export interface AgentServiceOptions {
  store?: TaskStore;
  broadcaster?: EventBroadcaster;
  broker?: PermissionBroker;
  runnerFactory?: RunnerFactory;
}

/** Snapshot of the local settings the dashboard is allowed to see. */
export interface SettingsSnapshot {
  browser: {
    engine: string;
    headless: boolean;
    maxTabs: number;
    navigationTimeoutMs: number;
    actionTimeoutMs: number;
  };
  limits: {
    maxAgentSteps: number;
    maxDownloads: number;
    maxFileSizeMb: number;
    maxTaskTimeMs: number;
  };
  ai: {
    enabled: boolean;
    modelId: string;
    quantization: string;
    embeddingModelId: string;
  };
  safety: {
    downloadAllowlist: string[];
    allowlistActive: boolean;
    requireDownloadConfirmation: boolean;
  };
}

/** Local model status, with the embeddings half of the pipeline included. */
export interface ModelStatus extends ModelInfo {
  embeddingStatus: ModelInfo['status'];
  unavailable: string | null;
  embeddingUnavailable: string | null;
}

export class AgentService {
  private readonly store: TaskStore;
  readonly broadcaster: EventBroadcaster;
  readonly broker: PermissionBroker;
  private readonly runnerFactory: RunnerFactory;

  private readonly channels = new Map<string, TaskChannel>();
  private readonly queue: string[] = [];
  private active: { taskId: string; runner: AgentRunner; signal: CancellationToken } | null = null;
  private draining = false;
  private disposed = false;
  private browserStatusValue = 'stopped';

  /** Shared across runs so weights are loaded at most once per process. */
  private modelManager = new ModelManager();
  private embeddingManager = new EmbeddingManager();

  constructor(options: AgentServiceOptions = {}) {
    this.store = options.store ?? createTaskStore();
    this.broadcaster = options.broadcaster ?? createEventBroadcaster();
    this.broker = options.broker ?? new PermissionBroker();
    this.runnerFactory = options.runnerFactory ?? createDefaultRunner;
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  /** Persists a task and (by default) queues it for execution. */
  createTask(input: CreateTaskRequest): Task {
    const prompt = input.prompt.trim();
    const autoRun = input.autoRun ?? true;
    const task = this.store.createTask({ prompt });
    const channel = this.channelFor(task.id);

    channel.emit('TASK_QUEUED', 'info', `Task queued: ${prompt.slice(0, 120)}`, {
      autoRun,
      prompt,
    });

    if (autoRun) this.enqueue(task.id);
    return task;
  }

  getTask(taskId: string): Task | null {
    return this.store.getTask(taskId);
  }

  listTasks(limit = 50): Task[] {
    return this.store.listTasks(limit);
  }

  listEvents(taskId: string, sinceSequence = -1, limit = 500): AgentEvent[] {
    return this.store.listEvents(taskId, sinceSequence, limit);
  }

  /** Number of tasks waiting behind the active run (1 browser at a time). */
  get queueLength(): number {
    return this.queue.length;
  }

  get activeTaskId(): string | null {
    return this.active?.taskId ?? null;
  }

  /**
   * Cancels a task: removes it from the queue, or asks the running engine to
   * stop. A queued task never starts a browser.
   */
  cancelTask(taskId: string): boolean {
    const queuedIndex = this.queue.indexOf(taskId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.broker.denyAll(taskId, 'task cancelled while queued');
      this.channelFor(taskId).emit('TASK_CANCELLED', 'warn', 'Task cancelled before it started');
      this.store.updateTask(taskId, { status: 'cancelled', completedAt: nowIso() });
      return true;
    }

    if (this.active?.taskId === taskId) {
      this.active.runner.stop();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  pendingPermissions(taskId?: string): PermissionRequest[] {
    return this.broker.list(taskId);
  }

  /** Records a human decision for a pending request. */
  decidePermission(
    taskId: string,
    permissionIdValue: string,
    decision: PermissionDecision,
  ): boolean {
    if (!this.broker.get(taskId, permissionIdValue)) return false;
    return this.broker.resolve(permissionIdValue, decision);
  }

  // ---------------------------------------------------------------------------
  // Downloads / models / settings
  // ---------------------------------------------------------------------------

  listDownloads(taskId?: string, limit = 200) {
    return this.store.listDownloads(taskId, limit);
  }

  modelStatus(): ModelStatus {
    const info = this.modelManager.info();
    const embeddingStatus: ModelInfo['status'] = this.embeddingManager.isLoaded
      ? 'loaded'
      : this.embeddingManager.unavailable
        ? 'unavailable'
        : info.status === 'disabled'
          ? 'disabled'
          : 'not-loaded';
    return {
      ...info,
      embeddingStatus,
      unavailable: this.modelManager.unavailable,
      embeddingUnavailable: this.embeddingManager.unavailable,
    };
  }

  browserStatus(): string {
    return this.browserStatusValue;
  }

  /** Configuration the dashboard may display (never paths, never the .env). */
  settings(): SettingsSnapshot {
    return {
      browser: {
        engine: config.browser.engine,
        headless: config.browser.headless,
        maxTabs: config.browser.maxTabs,
        navigationTimeoutMs: config.browser.navigationTimeoutMs,
        actionTimeoutMs: config.browser.actionTimeoutMs,
      },
      limits: {
        maxAgentSteps: config.limits.maxAgentSteps,
        maxDownloads: config.limits.maxDownloads,
        maxFileSizeMb: Math.round(config.limits.maxFileSizeBytes / (1_024 * 1_024)),
        maxTaskTimeMs: config.limits.maxTaskTimeMs,
      },
      ai: {
        enabled: config.ai.enabled,
        modelId: config.ai.modelId,
        quantization: config.ai.quantization,
        embeddingModelId: config.ai.embeddingModelId,
      },
      safety: {
        downloadAllowlist: [...config.safety.downloadAllowlist],
        allowlistActive: config.safety.downloadAllowlist.length > 0,
        requireDownloadConfirmation: config.safety.requireDownloadConfirmation,
      },
    };
  }

  /** Stops everything (shutdown / tests) and refuses outstanding prompts. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.queue.length = 0;
    this.active?.runner.stop();
    this.broker.denyAll(undefined, 'server shutting down');
    await this.modelManager.unload().catch(() => undefined);
    await this.embeddingManager.unload().catch(() => undefined);
    this.broadcaster.clear();
    this.channels.clear();
  }

  // ---------------------------------------------------------------------------
  // Queue & execution
  // ---------------------------------------------------------------------------

  private enqueue(taskId: string): void {
    this.queue.push(taskId);
    void this.drain();
  }

  /**
   * Runs queued tasks one at a time. A single browser at a time keeps memory and
   * download caps meaningful on a laptop, and makes "which task owns the
   * browser" unambiguous.
   */
  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const taskId = this.queue.shift();
        if (!taskId) break;
        await this.runTask(taskId);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) return;

    const channel = this.channelFor(taskId);
    const signal = new CancellationToken();

    const runner = this.runnerFactory({
      taskId,
      prompt: task.prompt,
      channel,
      onPermissionRequest: (request) => this.broker.request(taskId, request),
      onBrowserStatus: (status, detail) => {
        this.browserStatusValue = status;
        channel.emit('BROWSER_STATUS', 'info', `browser ${status}`, {
          status,
          ...(detail ?? {}),
        });
      },
      modelManager: this.modelManager,
      embeddingManager: this.embeddingManager,
    });

    this.active = { taskId, runner, signal };
    this.store.updateTask(taskId, { status: 'running', startedAt: nowIso() });

    try {
      const result = await runner.run(taskId, task.prompt, signal);
      this.finalize(taskId, result, channel);
    } catch (error) {
      // The engine already emitted TASK_FAILED for its own failures; this branch
      // only catches a runner that threw outside the loop (e.g. browser launch).
      const wpError = toWebPilotError(error, 'UNKNOWN');
      channel.emit('TASK_FAILED', 'error', `Task failed: ${wpError.message}`, undefined, wpError);
      this.store.updateTask(taskId, {
        status: 'failed',
        completedAt: nowIso(),
        error: wpError.message,
      });
    } finally {
      // Fail closed: anything still waiting for a human is denied when the run ends.
      const denied = this.broker.denyAll(taskId, 'task finished');
      if (denied > 0) log.info('denied outstanding permissions', { taskId, denied });
      this.active = null;
      this.browserStatusValue = 'stopped';
      this.channels.delete(taskId);
      const updated = this.store.getTask(taskId);
      if (updated) this.broadcaster.publishTask(taskId, updated);
    }
  }

  /** Writes the final task state and mirrors the download manifest into SQLite. */
  private finalize(taskId: string, result: AgentRunResult, channel: TaskChannel): void {
    // A denied permission means the run must not proceed, even if the runner
    // returned a more optimistic status.
    const denied = this.broker.hasDenied(taskId);
    const status: TaskStatus = denied
      ? 'cancelled'
      : result.status === 'completed'
        ? 'completed'
        : result.status === 'cancelled'
          ? 'cancelled'
          : 'failed';

    const files = this.syncDownloads(taskId, result);

    this.store.updateTask(taskId, {
      status,
      completedAt: nowIso(),
      error: result.error,
      stepCount: result.steps,
      downloadsCount: Math.max(result.downloaded, files),
      currentUrl: result.state.currentUrl ?? null,
    });

    const updated = this.store.getTask(taskId);
    if (updated) this.broadcaster.publishTask(taskId, updated);
    log.info('task finished', { taskId, status, steps: result.steps, downloads: files });
  }

  private syncDownloads(taskId: string, result: AgentRunResult): number {
    try {
      const directory = taskDirectory(taskId, config.downloadsDir);
      const manifest = readManifest(directory, taskId, result.state.goal || null);
      return this.store.syncManifest(taskId, manifest);
    } catch (error) {
      log.warn('manifest sync failed', { taskId, error: (error as Error).message });
      return 0;
    }
  }

  /** Returns the task's channel, creating it (and its persistence sink) once. */
  private channelFor(taskId: string): TaskChannel {
    const existing = this.channels.get(taskId);
    if (existing) return existing;

    const channel = createTaskChannel(taskId, (event) => {
      try {
        this.store.appendEvent(event);
      } catch (error) {
        log.warn('event persistence failed', { taskId, error: (error as Error).message });
      }
      this.broadcaster.publish(event);
    });

    this.channels.set(taskId, channel);
    return channel;
  }
}

export function createAgentService(options: AgentServiceOptions = {}): AgentService {
  return new AgentService(options);
}
