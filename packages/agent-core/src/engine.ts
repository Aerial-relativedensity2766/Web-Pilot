import type {
  BrowserController,
  BrowserManager,
} from '@webpilot/browser-core';
import type {
  Downloader,
  DownloadRequest,
} from '@webpilot/download-core';
import {
  planWithRules,
  parseModelOutput,
  buildPlannerUserMessage,
  PLANNER_SYSTEM_PROMPT,
  rankImages,
  rankLinks,
  rankTexts,
  rankCandidates,
  slugForGoal,
  type ModelManager,
  type EmbeddingManager,
  type PlannerInput,
} from '@webpilot/ai-core';
import { validateAction, type ValidationResult } from './validator';
import { replanForFailure } from './replanner';
import {
  createInitialState,
  advanceState,
  recordError,
  stepsRemaining,
} from './state';
import { observePage, summarizeExtraction, summarizeDownload } from './observer';
import {
    WebPilotError,
  toWebPilotError,
  describeAction,
  type Action,
  type AgentState,
  type AgentEvent,
  type AgentEventType,
  type DownloadCandidate,
  type ExtractedImage,
  type ExtractedLink,
  type ExtractedTextBlock,
  type LogLevel,
  type PageState,
  type PermissionRequest,
  type RankedItem,
  type TaskPlan,
} from '@webpilot/schemas';
import {
  CancellationToken,
  config,
  eventId,
  elapsedMs,
  loggerFor,
  nowIso,
  sleep,
  withTimeout,
  type EventBus,
} from '@webpilot/shared';

const log = loggerFor('agent:engine');

/** Result of a single agent run. */
export interface AgentRunResult {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  steps: number;
  downloaded: number;
  error: string | null;
  state: AgentState;
}

export interface ExecutionResult {
  summary: string;
  detail?: string;
  data?: Record<string, unknown>;
}

export interface PermissionDecision {
  granted: boolean;
  remember?: boolean;
}

export interface AgentEngineOptions {
  /** Browser lifecycle (launch/close). */
  browserManager: BrowserManager;
  /** Validates and executes individual actions against Playwright. */
  controller: BrowserController;
  /** Optional downloader for `download` actions. */
  downloader?: Downloader;
  /** Optional local model for AI planning. */
  modelManager?: ModelManager;
  /** Optional local embedding model for semantic ranking. */
  embeddingManager?: EmbeddingManager;
  /** Event bus the engine publishes to. */
  eventBus: EventBus<AgentEvent>;
  /** Optional callback when a permission is required. */
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
  /** Override for the max steps cap. */
    maxSteps?: number;
  /** Override for the max task wall-clock time. */
  maxTaskTimeMs?: number;
}

/**
 * The AgentEngine is the heart of WebPilot: it owns the agent loop that
 * turns a natural-language prompt into a sequence of validated, observed
 * browser actions, with AI-powered replanning on failure.
 *
 * Design principles (§55 of the spec):
 *   - **AI should decide.** Code should execute.
 *   - Every action passes through `ActionSchema` validation and the runtime
 *     policy checker before reaching Playwright.
 *   - Failures are structured (`WebPilotError`) so the replanner can reason
 *     about them and pick an alternative strategy.
 */
export class AgentEngine {
  private log = loggerFor('agent:engine');
  private taskId = 'unknown';
  private signal: CancellationToken;
  private state: AgentState;
  private planQueue: Action[] = [];
  private planSource: 'rule' | 'ai' | 'replan' = 'rule';
  private sequence = 0;
  private readonly maxSteps: number;
  private readonly maxTaskTimeMs: number;
  private readonly permissionCache = new Set<string>();
  private startedAt = 0;

  constructor(private readonly options: AgentEngineOptions) {
    this.signal = new CancellationToken();
    this.state = this.createInitialAgentState();
        this.maxSteps = options.maxSteps ?? config.limits.maxAgentSteps;
    this.maxTaskTimeMs = options.maxTaskTimeMs ?? config.limits.maxTaskTimeMs;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Runs a complete task: plan → validate → execute → observe → evaluate,
   * with automatic replanning on recoverable failures.
   */
  async run(taskId: string, prompt: string, signal?: CancellationToken): Promise<AgentRunResult> {
    this.taskId = taskId;
    this.signal = signal ?? new CancellationToken();
    this.startedAt = Date.now();
    this.log = loggerFor(`agent:engine:${taskId}`);

    const aiAvailable = !!this.options.modelManager?.enabled;

    this.state = createInitialState({
      taskId,
      goal: prompt,
      maxSteps: this.maxSteps,
      aiAvailable,
    });

    this.emit('TASK_STARTED', 'info', `Task started: ${prompt.slice(0, 120)}`, {
      aiAvailable,
      maxSteps: this.maxSteps,
    });

    try {
      await this.options.browserManager.launch();

      const result = await this.agentLoop(prompt);
      return result;
    } catch (error) {
      const wpError = toWebPilotError(error, 'UNKNOWN');
      if (wpError.code === 'TASK_CANCELLED') {
        this.emit('TASK_CANCELLED', 'warn', 'Task was cancelled by the user');
        return { taskId, status: 'cancelled', steps: this.state.step, downloaded: this.state.downloaded.length, error: null, state: this.state };
      }
      this.emit('TASK_FAILED', 'error', `Task failed: ${wpError.message}`, undefined, wpError);
      return { taskId, status: 'failed', steps: this.state.step, downloaded: this.state.downloaded.length, error: wpError.message, state: this.state };
    } finally {
      await this.options.browserManager.close().catch((error) => {
        this.log.warn('browser close failed', { error });
      });
    }
  }

  /** Stops the current run by cancelling the token. */
  stop(): void {
    this.signal.cancel('stopped by user');
  }

  get currentRunState(): AgentState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Event helpers
  // ---------------------------------------------------------------------------

  private nextSequence(): number {
    return ++this.sequence;
  }

  private emit(
    type: AgentEventType,
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: WebPilotError,
    ): void {
    const seq = this.nextSequence();
    const event: AgentEvent = {
      id: eventId(this.taskId, seq),
      taskId: this.taskId,
      type,
      sequence: seq,
      level,
      message,
      ...(data ? { data } : {}),
      ...(error ? { error: error.toPayload() } : {}),
      at: nowIso(),
    };
    this.options.eventBus.emit(event);
        if (level === 'error') this.log.error(message, { type, ...data });
    else if (level === 'warn') this.log.warn(message, { type, ...data });
    else this.log.debug(message, { type, ...data });
  }

  // ---------------------------------------------------------------------------
  // Agent loop
  // ---------------------------------------------------------------------------

  /**
   * The core loop:
   *   while not done / not cancelled / under max steps / under max time:
   *     understand → plan → validate → execute → observe → evaluate
   *     if a step failed → replan
   */
  private async agentLoop(prompt: string): Promise<AgentRunResult> {
    let completed = false;

    while (this.isRunning()) {
      this.signal.throwIfCancelled();

      // Check task timeout
      if (elapsedMs(this.startedAt) > this.maxTaskTimeMs) {
        throw new WebPilotError('TASK_TIMEOUT', `Task exceeded ${this.maxTaskTimeMs}ms`, { recoverable: false });
      }

      // --- understand ---------------------------------------------------------
      const pageState = await this.safeObserve();
      const contextSummary = observePage(this.state.goal, pageState, this.state);

      // --- plan ---------------------------------------------------------------
      const plan = await this.planFromStrategy(prompt, contextSummary);
      this.planSource = plan.source;

      this.emit('PLAN_CREATED', 'info', `Plan created (${plan.source}, ${plan.steps.length} step(s))`, {
        steps: plan.steps.map((step) => describeAction(step)),
        warnings: plan.warnings,
      });

      // --- execute each step --------------------------------------------------
      for (const action of plan.steps) {
        if (!this.isRunning()) break;
        this.signal.throwIfCancelled();

        completed = await this.executeStep(action);
        if (completed) {
          this.emit('TASK_COMPLETED', 'info', `Task completed after ${this.state.step} step(s)`, {
            steps: this.state.step,
            downloaded: this.state.downloaded.length,
          });
          return { taskId: this.taskId, status: 'completed', steps: this.state.step, downloaded: this.state.downloaded.length, error: null, state: this.state };
        }
      }

      // Plan exhausted — try again with fresh context if not done
      if (!completed && this.isRunning()) {
        await sleep(100);
      }
    }

    if (this.signal.isCancelled) {
      this.emit('TASK_CANCELLED', 'warn', 'Task was cancelled');
      return { taskId: this.taskId, status: 'cancelled', steps: this.state.step, downloaded: this.state.downloaded.length, error: null, state: this.state };
    }

    this.emit('TASK_COMPLETED', 'info', `Task finished after ${this.state.step} step(s)`, {
      steps: this.state.step,
      downloaded: this.state.downloaded.length,
    });
    return { taskId: this.taskId, status: 'completed', steps: this.state.step, downloaded: this.state.downloaded.length, error: null, state: this.state };
  }

    private isRunning(): boolean {
    return stepsRemaining(this.state) && !this.signal.isCancelled;
  }

  // ---------------------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------------------

  private async planFromStrategy(prompt: string, contextSummary: string): Promise<TaskPlan> {
    // If there are queued actions from a previous plan, use them first
    if (this.planQueue.length > 0) {
      const steps = this.planQueue.splice(0, 1);
      return { goal: this.state.goal, steps, source: this.planSource, warnings: [], createdAt: nowIso() };
    }

    const plannerInput: PlannerInput = { prompt, contextSummary };

    // Try AI planning first
    if (this.options.modelManager && this.options.modelManager.enabled) {
      const aiPlan = await this.tryAiPlan(prompt, contextSummary);
      if (aiPlan) return aiPlan;
    }

    // Fall back to rule-based planning
    this.emit('AI_UNAVAILABLE', 'warn', 'AI unavailable or failed, using rule-based planner');
    return planWithRules(plannerInput);
  }

  private async tryAiPlan(goal: string, contextSummary: string): Promise<TaskPlan | null> {
    this.emit('AI_THINKING', 'info', 'Planning with local AI model');
    try {
      const userMessage = buildPlannerUserMessage(goal, contextSummary);
      const raw = await withTimeout(
        Promise.resolve(this.options.modelManager!.generate(userMessage, PLANNER_SYSTEM_PROMPT)),
        30_000,
        'AI planning timed out',
        'AI_TIMEOUT',
      );

      if (!raw) return null;

      const parsed = parseModelOutput(raw, goal);
      if (parsed.steps.length === 0) return null;

      this.emit('AI_THINKING', 'info', `AI produced plan with ${parsed.steps.length} step(s)`, {
        source: parsed.source,
        warnings: parsed.warnings,
      });

      // Queue remaining steps for subsequent iterations
      this.planQueue = parsed.steps.slice(1);
      return {
        goal: parsed.goal,
        steps: [parsed.steps[0]!],
        source: 'ai',
        warnings: parsed.warnings,
        createdAt: nowIso(),
      };
    } catch (error) {
      const wpError = toWebPilotError(error, 'AI_TIMEOUT');
      this.emit('LOG', 'warn', `AI planning failed: ${wpError.message}`, undefined, wpError);
            return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Action execution
  // ---------------------------------------------------------------------------

  /**
   * Executes a single step: validate → permission → execute → observe → evaluate.
   * Returns true when the task is complete after this step.
   */
  private async executeStep(action: Action): Promise<boolean> {
    // Validate
    const validation = validateAction(action);
    if (!validation.ok) {
      this.emit('ACTION_REJECTED', 'error', `Action rejected: ${validation.error.message}`, { action: describeAction(action) }, validation.error);
      this.state = recordError(this.state, {
        code: validation.error.code,
        message: validation.error.message,
        recoverable: validation.error.recoverable,
      }, action);
      return false;
    }

    this.emit('ACTION_PLANNED', 'debug', describeAction(validation.action), {
      action: describeAction(validation.action),
      needsPermission: validation.needsPermission,
    });

    // Permission gate
    if (validation.needsPermission && validation.permissionKind) {
      const granted = await this.requestPermission(validation);
      if (!granted) {
        this.state = recordError(this.state, {
          code: 'PERMISSION_DENIED',
          message: `Permission denied for ${validation.permissionKind}`,
          recoverable: false,
        }, action);
        return false;
      }
    }

    // Execute
    this.emit('ACTION_STARTED', 'info', describeAction(validation.action));

    try {
      const result = await withTimeout(
        this.executeAction(validation.action),
        60_000,
        'Action timed out',
        'ACTION_TIMEOUT',
      );

      // Update state with the action outcome
      const currentUrl = typeof result.data?.url === 'string' ? result.data.url : undefined;
      const pageTitle = typeof result.data?.title === 'string' ? result.data.title : undefined;

      this.state = advanceState(this.state, {
        action: validation.action,
        actionSummary: describeAction(validation.action),
        resultSummary: result.summary,
        currentUrl: currentUrl,
        pageTitle: pageTitle,
      });

      this.emit('ACTION_COMPLETED', 'info', result.summary, result.data);

      // Evaluate if the task is complete
      return this.evaluateCompletion(validation.action, result);
    } catch (error) {
      const wpError = toWebPilotError(error, 'UNKNOWN');

      this.emit('ACTION_FAILED', 'error',
        `${describeAction(validation.action)} failed: ${wpError.message}`,
        { attempt: this.state.errors.length }, wpError);

      this.state = recordError(this.state, {
        code: wpError.code,
        message: wpError.message,
        recoverable: wpError.recoverable,
      }, action);

      // Attempt recovery via replanner
      const recovery = replanForFailure({
        action: validation.action,
        error: wpError,
        attempt: this.state.errors.length,
      });

      if (recovery.strategy === 'abort') {
        throw wpError;
      }

      if (recovery.strategy === 'retry_alternative' && recovery.alternative) {
        this.planQueue = [recovery.alternative, ...this.planQueue];
        this.emit('LOG', 'info', `Replanning: ${recovery.reason}`);
      }

            return false;
    }
  }

  /** Dispatches a validated action to the appropriate controller method. */
  private async executeAction(action: Action): Promise<ExecutionResult> {
    switch (action.type) {
      case 'navigate':
        return this.options.controller.navigate(action);

      case 'click':
        return this.options.controller.click(action);

      case 'type':
        return this.options.controller.type(action);

      case 'press':
        return this.options.controller.press(action);

      case 'scroll':
        return this.options.controller.scroll(action);

      case 'wait':
        return this.options.controller.wait(action);

      case 'extract':
        return this.executeExtract(action);

      case 'download':
        return this.executeDownload(action);

      default:
        throw new WebPilotError('ACTION_INVALID', `Unknown action type: ${(action as { type: string }).type as string}`, { recoverable: false });
    }
  }

  /** Extracts content and ranks it semantically before storing in state. */
  private async executeExtract(action: { target: string; query?: string; limit?: number; selector?: string; count?: never }): Promise<ExecutionResult> {
    const result = await this.options.controller.extract(action as Parameters<BrowserController['extract']>[0]);
    const items = (result.data?.items as unknown[] | undefined) ?? [];

    if (action.query) {
      const ranked = await this.rankItems(action.target, action.query, items);

      this.state = {
        ...this.state,
        candidates: ranked,
        selected: ranked.slice(0, Math.min(ranked.length, 10)),
      };

      this.emit('ITEMS_RANKED', 'info', summarizeExtraction({
        target: action.target,
        count: items.length,
        selected: ranked.length,
        query: action.query,
      }), { query: action.query, rankedCount: ranked.length });

      for (const item of ranked.slice(0, 5)) {
        this.emit('ITEM_FOUND', 'debug', item.text.slice(0, 80), {
          kind: item.kind,
          score: item.score,
        });
      }
    }

        return result as unknown as ExecutionResult;
    }

  // ---------------------------------------------------------------------------
  // Ranking
  // ---------------------------------------------------------------------------

  private async rankItems(
    target: string,
    query: string,
    items: readonly unknown[],
  ): Promise<RankedItem[]> {
    if (target === 'images') {
      const images = items as ExtractedImage[];
      const semanticScores = await this.computeSemanticScores(query, images.map((i) => i.alt));
      return rankImages(query, images, { topK: 50, semanticScores, semanticWeight: 0.4 }).map((r) => ({
        key: r.key,
        kind: 'image' as const,
        text: r.text,
        score: r.score,
        lexicalScore: r.lexicalScore,
        semanticScore: r.semanticScore,
        item: r.image,
      }));
    }

    if (target === 'links') {
      const links = items as ExtractedLink[];
      const semanticScores = await this.computeSemanticScores(query, links.map((l) => l.text));
      return rankLinks(query, links, { topK: 50, semanticScores, semanticWeight: 0.4 }).map((r) => ({
        key: r.key,
        kind: 'link' as const,
        text: r.text,
        score: r.score,
        lexicalScore: r.lexicalScore,
        semanticScore: r.semanticScore,
        item: r.link,
      }));
    }

    if (target === 'text') {
      const blocks = items as ExtractedTextBlock[];
      const semanticScores = await this.computeSemanticScores(query, blocks.map((b) => b.text));
      return rankTexts(query, blocks, { topK: 50, semanticScores, semanticWeight: 0.4 }).map((r) => ({
        key: r.key,
        kind: 'text' as const,
        text: r.text,
        score: r.score,
        lexicalScore: r.lexicalScore,
        semanticScore: r.semanticScore,
        item: r.block,
      }));
    }

    // For tables, buttons, inputs — no semantic ranking, just pass through
    return items.map((item, index) => ({
      key: String(index),
      kind: target as 'table' | 'button' | 'input',
      text: JSON.stringify(item).slice(0, 200),
      score: 1,
      item,
    }));
  }
  private async executeDownload(action: {
    count: number;
    query?: string;
    candidates?: DownloadCandidate[];
    targetDir?: string;
  }): Promise<ExecutionResult> {
    if (!this.options.downloader) {
      throw new WebPilotError(
        'CONFIG_INVALID',
        'No downloader is configured for this run',
        { recoverable: false },
      );
    }

    let candidates: DownloadCandidate[] = [];

    if (action.candidates && action.candidates.length > 0) {
      candidates = action.candidates;
    } else {
      // Use ranked candidates from the last extraction
      candidates = this.state.candidates
        .filter((c) => c.kind === 'image' || c.kind === 'link')
        .map((c) => this.toDownloadCandidate(c));
    }

    if (candidates.length === 0) {
      throw new WebPilotError('NO_CANDIDATES', 'No download candidates available — run an extract first');
    }

    // Re-rank by the download query if provided
    if (action.query) {
      candidates = await this.rankDownloadCandidates(action.query, candidates);
    }

    const slug = this.deriveSlug(action.query);
    const toDownload = candidates.slice(0, Math.min(action.count, candidates.length));

    this.emit('DOWNLOAD_STARTED', 'info', `Downloading ${toDownload.length} of ${action.count} requested file(s)`);

        const requests: DownloadRequest[] = toDownload.map((candidate, index) => ({
      taskId: this.taskId,
      goal: this.state.goal,
      url: candidate.url,
      filename: candidate.filename,
      alt: candidate.alt,
      sourcePage: candidate.sourcePage,
      slug,
      index: index + 1,
      targetDir: action.targetDir,
      expect: 'image' as const,
    }));

    const batch = await this.options.downloader.downloadMany(requests, {
      count: action.count,
      taskId: this.taskId,
      goal: this.state.goal,
    });

    const downloadedUrls = batch.results
      .filter((r) => r.outcome.ok && !r.outcome.duplicate)
      .map((r) => r.outcome.record.filename ?? '');

    this.state = {
      ...this.state,
      downloaded: [...this.state.downloaded, ...downloadedUrls],
      remaining: Math.max(0, this.state.remaining - batch.completed),
    };

    this.emit('DOWNLOAD_COMPLETED', 'info', summarizeDownload({
      completed: batch.completed,
      requested: action.count,
      duplicates: batch.duplicates,
      failed: batch.failed,
    }), {
      completed: batch.completed,
      failed: batch.failed,
      duplicates: batch.duplicates,
    });

    return {
      summary: `downloaded ${batch.completed}/${action.count} file(s)`,
      data: {
        completed: batch.completed,
        failed: batch.failed,
        duplicates: batch.duplicates,
        downloaded: batch.results
          .filter((r) => r.outcome.ok)
          .map((r) => ({
            filename: r.outcome.record.filename,
            url: r.outcome.record.url,
            size: r.outcome.record.size,
            sha256: r.outcome.record.sha256,
          })),
      },
        };
  }

  // ---------------------------------------------------------------------------
  // Ranking helpers
  // ---------------------------------------------------------------------------

  private async rankDownloadCandidates(
    query: string,
    candidates: DownloadCandidate[],
  ): Promise<DownloadCandidate[]> {
    const texts = candidates.map((c) => c.alt ?? c.filename ?? c.url);
    const semanticScores = await this.computeSemanticScores(query, texts);

    const ranked = rankCandidates(
      query,
      candidates.map((c) => ({
        key: c.url,
        kind: 'image' as const,
        text: c.alt ?? c.filename ?? c.url,
        item: c,
      })),
      { topK: candidates.length, semanticScores, semanticWeight: 0.4 },
    );

    return ranked.map((r) => r.item as DownloadCandidate);
  }

  private async computeSemanticScores(
    query: string,
    texts: readonly string[],
  ): Promise<number[] | undefined> {
    if (!this.options.embeddingManager?.enabled) return undefined;
    try {
      const scores = await withTimeout(
        Promise.resolve(this.options.embeddingManager.similarityToQuery(query, texts)),
        30_000,
        'Embedding inference timed out',
        'AI_TIMEOUT',
      );
      return scores ?? undefined;
    } catch (error) {
      this.log.warn('semantic scoring failed, using lexical only', {
        error: (error as Error).message,
      });
      return undefined;
    }
  }

  private toDownloadCandidate(item: RankedItem): DownloadCandidate {
    if (item.kind === 'image') {
      const image = item.item as ExtractedImage;
      return { url: image.url, alt: image.alt, sourcePage: image.sourcePage };
    }
    if (item.kind === 'link') {
      const link = item.item as ExtractedLink;
      return { url: link.url, alt: link.text, sourcePage: link.sourcePage };
    }
    const value = item.item as Record<string, unknown>;
    const url = typeof value.url === 'string' ? value.url : '';
    return { url, alt: item.text };
  }

  private deriveSlug(query: string | undefined): string {
    if (query) {
      const cleaned = query.replace(/\.(jpg|jpeg|png|gif|webp|svg|ico|bmp)$/i, '').trim();
      const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
      if (words.length > 0) {
        return words.slice(0, 3).join('-').toLowerCase().slice(0, 40);
      }
    }
    return slugForGoal(this.state.goal);
  }

  // ---------------------------------------------------------------------------
  // Observation & evaluation
  // ---------------------------------------------------------------------------

  private async safeObserve(): Promise<PageState> {
    try {
      return await this.options.controller.observe();
    } catch (error) {
      this.log.warn('observation failed', { error });
      return {
        url: '',
        title: '',
        links: 0,
        images: 0,
        buttons: 0,
        inputs: 0,
        forms: 0,
        headings: 0,
        textLength: 0,
        interactive: [],
        capturedAt: nowIso(),
      };
    }
  }

  private evaluateCompletion(action: Action, result: ExecutionResult): boolean {
    if (action.type === 'download') {
      const data = result.data as { completed?: number } | undefined;
      const count = typeof data?.completed === 'number' ? data.completed : 0;
      if (count >= action.count) return true;
      return this.state.remaining <= 0 && this.state.downloaded.length >= 1;
    }

    if (action.type === 'extract') {
      return this.state.candidates.length > 0;
    }

    return false;
  }

  private createInitialAgentState(): AgentState {
    return createInitialState({
      taskId: 'pending',
      goal: '',
      maxSteps: this.maxSteps,
      aiAvailable: !!this.options.modelManager?.enabled,
    });
  }

  private async requestPermission(validation: ValidationResult): Promise<boolean> {
    if (!validation.ok || !validation.permissionKind) return true;

    if (this.permissionCache.has(validation.permissionKind)) {
      return true;
    }

    if (!this.options.onPermissionRequest) {
      throw new WebPilotError(
        'PERMISSION_DENIED',
        `Permission required for ${validation.permissionKind} but no handler configured`,
        { recoverable: false },
      );
    }

    const estimateBytes =
      validation.action.type === 'download'
        ? validation.action.count * config.limits.maxFileSizeBytes
        : undefined;

    const request: PermissionRequest = {
      id: `perm-${this.nextSequence()}`,
      taskId: this.taskId,
      kind: validation.permissionKind,
      title: validation.permissionTitle ?? 'Permission required',
      description: validation.permissionDescription ?? '',
      status: 'pending',
      createdAt: nowIso(),
      ...(validation.action ? { action: validation.action } : {}),
      ...(estimateBytes !== undefined ? { estimatedBytes: estimateBytes } : {}),
      ...(validation.action.type === 'download'
        ? { itemCount: validation.action.count }
        : {}),
    };

    this.emit('PERMISSION_REQUESTED', 'info', `Permission required: ${request.title}`, {
      kind: request.kind,
      taskId: this.taskId,
    });

    const decision = await this.options.onPermissionRequest(request);

    if (decision.granted) {
      this.emit('PERMISSION_GRANTED', 'info', `Permission granted for ${request.kind}`);
      if (decision.remember) {
        this.permissionCache.add(request.kind);
      }
      return true;
    }

    this.emit('PERMISSION_DENIED', 'warn', `Permission denied for ${request.kind}`);
    return false;
  }
}


