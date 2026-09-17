import { config, loggerFor, withTimeout } from '@webpilot/shared';

const log = loggerFor('ai:embeddings');

type EmbeddingPipeline = (
  texts: string | string[],
  options?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Local MiniLM embedding manager (Transformers.js, lazy like ModelManager).
 * When the model is missing, `embed()` returns null and ranking degrades to
 * the lexical signal instead of failing the task.
 */
export class EmbeddingManager {
  private pipeline: EmbeddingPipeline | null = null;
  private loading: Promise<EmbeddingPipeline | null> | null = null;
  private unavailableReason: string | null = null;

  constructor(
    private readonly options: {
      modelsDir?: string;
      modelId?: string;
      enabled?: boolean;
    } = {},
  ) {}

  get modelId(): string {
    return this.options.modelId ?? config.ai.embeddingModelId;
  }

  get enabled(): boolean {
    return this.options.enabled ?? config.ai.enabled;
  }

  get isLoaded(): boolean {
    return this.pipeline !== null;
  }

  get unavailable(): string | null {
    return this.unavailableReason;
  }

  async ensureLoaded(): Promise<EmbeddingPipeline | null> {
    if (!this.enabled) return null;
    if (this.pipeline) return this.pipeline;
    if (this.loading) return this.loading;
    this.loading = this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** Embeds a batch; null when model unavailable (lexical fallback). */
  async embed(texts: readonly string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];
    const pipe = await this.ensureLoaded();
    if (!pipe) return null;
    try {
      const raw = await withTimeout(
        Promise.resolve(pipe([...texts], { pooling: 'mean', normalize: true })),
        60_000,
        'Embedding inference timed out',
        'AI_TIMEOUT',
      );
      return toVectors(raw, texts.length);
    } catch (error) {
      log.warn('embedding inference failed', { error });
      return null;
    }
  }

  async similarityToQuery(query: string, candidates: readonly string[]): Promise<number[] | null> {
    const vectors = await this.embed([query, ...candidates]);
    if (!vectors || vectors.length !== candidates.length + 1) return null;
    const [queryVector, ...rest] = vectors as [number[], ...number[][]];
    return rest.map((vector) => cosineSimilarity01(queryVector, vector));
  }

  async unload(): Promise<void> {
    this.pipeline = null;
    this.loading = null;
  }

  private async load(): Promise<EmbeddingPipeline | null> {
    let transformers: Record<string, unknown>;
    try {
      transformers = (await import('@huggingface/transformers')) as Record<string, unknown>;
    } catch (error) {
      this.unavailableReason = `transformers runtime missing: ${(error as Error).message}`;
      return null;
    }
    const factory = transformers['pipeline'] as
      | ((task: string, model: string, opts?: Record<string, unknown>) => Promise<EmbeddingPipeline>)
      | undefined;
    if (!factory) {
      this.unavailableReason = 'transformers runtime has no pipeline() export';
      return null;
    }
    try {
      const modelsDir = this.options.modelsDir ?? config.modelsDir;
      const env = transformers['env'] as { cacheDir?: string; localModelPath?: string } | undefined;
      if (env) {
        if (typeof env.cacheDir !== 'undefined') env.cacheDir = modelsDir;
        if (typeof env.localModelPath !== 'undefined') env.localModelPath = modelsDir;
      }
      const args = { pooling: 'mean', normalize: true };
      const local = await factory('feature-extraction', this.modelId, {
        ...args,
        local_files_only: true,
      }).catch(() => null);
      this.pipeline =
        local ??
        ((await withTimeout(
          factory('feature-extraction', this.modelId, args),
          180_000,
          `Embedding load timed out for ${this.modelId}`,
          'AI_TIMEOUT',
        )) as EmbeddingPipeline);
      this.unavailableReason = null;
      log.info('embedding model loaded', { model: this.modelId });
      return this.pipeline;
    } catch (error) {
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      this.pipeline = null;
      log.warn('embedding model unavailable, lexical scores only', { error: this.unavailableReason });
      return null;
    }
  }
}

export function cosineSimilarity01(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, (cosine + 1) / 2));
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  return cosineSimilarity01(a, b) * 2 - 1;
}

function toVectors(raw: unknown, expected: number): number[][] | null {
  if (raw && typeof raw === 'object' && 'tolist' in raw && typeof raw.tolist === 'function') {
    try {
      const listed = (raw as { tolist: () => unknown }).tolist();
      if (Array.isArray(listed) && listed.length === expected) {
        const vectors = (listed as unknown[]).map((row) =>
          Array.isArray(row) ? (row as unknown[]).map(Number) : [],
        );
        if (vectors.every((v) => v.length > 0 && v.every(Number.isFinite))) return vectors as number[][];
      }
      return null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw) && raw.length === expected) {
    const vectors = (raw as unknown[]).map((row) => (Array.isArray(row) ? row.map(Number) : []));
    if (vectors.every((v) => v.length > 0 && v.every(Number.isFinite))) return vectors as number[][];
  }
  return null;
}

let sharedEmbeddings: EmbeddingManager | null = null;

export function sharedEmbeddingManager(): EmbeddingManager {
  if (!sharedEmbeddings) sharedEmbeddings = new EmbeddingManager();
  return sharedEmbeddings;
}

