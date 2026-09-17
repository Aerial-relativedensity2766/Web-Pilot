import type { RankedItem } from '@webpilot/schemas';

/** A candidate before it is scored — the text is what gets embedded. */
export interface RankCandidate {
  key: string;
  kind: RankedItem['kind'];
  text: string;
  item: unknown;
}

export interface RankOptions {
  /** Per-candidate semantic scores (0..1), aligned with `candidates`. */
  semanticScores?: ReadonlyArray<number | null | undefined>;
  /** Weight of the embedding signal in the hybrid score (default 0.4). */
  semanticWeight?: number;
  /** Maximum items to return (default: all, best first). */
  topK?: number;
}

export interface PlannerIntent {
  kind: 'collect_images' | 'research' | 'extract_data' | 'navigate_only' | 'general';
  count: number;
  subject: string;
  site?: string;
}

export interface PlannerInput {
  prompt: string;
  /** Where the run starts (fixture URL in tests, search engine otherwise). */
  startUrl?: string;
  /** Compact page summary for AI context (never raw HTML). */
  contextSummary?: string;
}

export interface ModelInfo {
  modelId: string;
  quantization: string;
  embeddingModelId: string;
  execution: 'local';
  networkInference: 'disabled' | 'enabled';
  /** `loaded` only after a pipeline was created in-process. */
  status: 'loaded' | 'not-loaded' | 'unavailable' | 'disabled';
  modelsDir: string;
}
