/**
 * @webpilot/ai-core
 *
 * Local AI: Qwen task planning plus MiniLM embeddings and hybrid semantic
 * ranking, all executed on device through Transformers.js. Every entry point
 * degrades gracefully when the weights are absent: planning falls back to the
 * deterministic rule planner and ranking falls back to lexical scores.
 */
export * from './types';
export * from './prompts';
export * from './ranking';
export * from './model-manager';
export * from './embeddings';
export * from './rule-planner';
export * from './parse-plan';
export * from './intent';
