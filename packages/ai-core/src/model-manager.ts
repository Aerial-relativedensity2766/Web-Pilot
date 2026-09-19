import { WebPilotError } from '@webpilot/schemas';
import { config, loggerFor, withTimeout } from '@webpilot/shared';
import type { ModelInfo } from './types';

const log = loggerFor('ai:model');

type TextPipeline = (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;

/**
 * Owns the local Qwen pipeline.
 * Lazy: nothing loads until first use. Offline-first: prefers cached files
 * so a cold start without network degrades to "unavailable", never hangs.
 */
export class ModelManager {
  private pipeline: TextPipeline | null = null;
  private loading: Promise<TextPipeline | null> | null = null;
  private unavailableReason: string | null = null;

  constructor(
    private readonly options: {
      modelsDir?: string;
      modelId?: string;
      quantization?: string;
      maxNewTokens?: number;
      enabled?: boolean;
      /** Override `config.ai.allowModelDownload` (tests). */
      allowModelDownload?: boolean;
    } = {},
  ) {}

  /** Weights are only fetched from the network when the user opts in. */
  get allowModelDownload(): boolean {
    return this.options.allowModelDownload ?? config.ai.allowModelDownload;
  }

  get modelId(): string {
    return this.options.modelId ?? config.ai.modelId;
  }

  get enabled(): boolean {
    return this.options.enabled ?? config.ai.enabled;
  }

  get maxNewTokens(): number {
    return this.options.maxNewTokens ?? config.ai.maxNewTokens;
  }

  get isLoaded(): boolean {
    return this.pipeline !== null;
  }

  get unavailable(): string | null {
    return this.unavailableReason;
  }

  info(): ModelInfo {
    return {
      modelId: this.modelId,
      quantization: this.options.quantization ?? config.ai.quantization,
      embeddingModelId: config.ai.embeddingModelId,
      execution: 'local',
      networkInference: 'disabled',
      status: !this.enabled
        ? 'disabled'
        : this.pipeline
          ? 'loaded'
          : this.unavailableReason
            ? 'unavailable'
            : 'not-loaded',
      modelsDir: this.options.modelsDir ?? config.modelsDir,
    };
  }

  async ensureLoaded(): Promise<TextPipeline | null> {
    if (!this.enabled) return null;
    if (this.pipeline) return this.pipeline;
    if (this.loading) return this.loading;
    this.loading = this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async unload(): Promise<void> {
    this.pipeline = null;
    this.loading = null;
  }

  private async load(): Promise<TextPipeline | null> {
    let transformers: Record<string, unknown>;
    try {
      transformers = (await import('@huggingface/transformers')) as Record<string, unknown>;
    } catch (error) {
      this.unavailableReason = `transformers runtime missing: ${(error as Error).message}`;
      log.warn('model unavailable (runtime import failed)', { error: this.unavailableReason });
      return null;
    }
    const factory = transformers['pipeline'] as
      | ((task: string, model: string, opts?: Record<string, unknown>) => Promise<TextPipeline>)
      | undefined;
    if (!factory) {
      this.unavailableReason = 'transformers runtime has no pipeline() export';
      return null;
    }
    try {
      const quantization = this.options.quantization ?? config.ai.quantization;
      const modelsDir = this.options.modelsDir ?? config.modelsDir;
      const env = transformers['env'] as
        | { cacheDir?: string; localModelPath?: string }
        | undefined;
      if (env) {
        if (typeof env.cacheDir !== 'undefined') env.cacheDir = modelsDir;
        if (typeof env.localModelPath !== 'undefined') env.localModelPath = modelsDir;
      }
      const localOnly = async (): Promise<TextPipeline> =>
        factory('text-generation', this.modelId, {
          dtype: quantization,
          device: 'cpu',
          local_files_only: true,
        });
      const remote = async (): Promise<TextPipeline> =>
        factory('text-generation', this.modelId, { dtype: quantization, device: 'cpu' });

      if (this.allowModelDownload) {
        this.pipeline = await withTimeout(
          localOnly().catch(() => remote()),
          180_000,
          `Model load timed out for ${this.modelId}`,
          'AI_TIMEOUT',
        );
      } else {
        // Offline by default: only pre-downloaded weights are used. A missing
        // model is an expected state, so this fails fast and the deterministic
        // rule planner takes over instead of stalling on a network fetch.
        this.pipeline = await localOnly();
      }
      this.unavailableReason = null;
      log.info('model loaded', { model: this.modelId });
      return this.pipeline;
    } catch (error) {
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      this.pipeline = null;
      log.warn('model failed to load, falling back to rule planner', { error: this.unavailableReason });
      return null;
    }
  }

  /** Generates planner text; null (never throws) when model unavailable. */
  async generate(userMessage: string, systemPrompt?: string): Promise<string | null> {
    const pipe = await this.ensureLoaded();
    if (!pipe) return null;
    try {
      const prompt = systemPrompt ? `${systemPrompt}\n\n${userMessage}` : userMessage;
      const raw = await withTimeout(
        Promise.resolve(pipe(prompt, { max_new_tokens: this.maxNewTokens, do_sample: false })),
        120_000,
        'Model inference timed out',
        'AI_TIMEOUT',
      );
      const text = extractGeneratedText(raw);
      return text?.trim() ? text.trim() : null;
    } catch (error) {
      log.warn('model inference failed', { error });
      return null;
    }
  }
}

/** Normalises the shapes pipeline('text-generation') can return. */
export function extractGeneratedText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const first = raw[0] as { generated_text?: unknown } | undefined;
    if (typeof first?.generated_text === 'string') return first.generated_text;
    return null;
  }
  if (raw && typeof raw === 'object') {
    const output = (raw as { generated_text?: unknown }).generated_text;
    if (typeof output === 'string') return output;
  }
  return null;
}

let sharedManager: ModelManager | null = null;

/** Process-wide manager (respects WEBPILOT_* env via config). */
export function sharedModelManager(): ModelManager {
  if (!sharedManager) sharedManager = new ModelManager();
  return sharedManager;
}

export function throwIfAiRequired(manager: ModelManager): void {
  if (!manager.enabled) {
    throw new WebPilotError('AI_MODEL_UNAVAILABLE', 'Local AI is disabled (WEBPILOT_AI_ENABLED=false)', {
      recoverable: false,
    });
  }
}

