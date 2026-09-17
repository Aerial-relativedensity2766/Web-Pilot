/**
 * @webpilot/agent-core — the autonomous agent engine.
 *
 * The `AgentEngine` turns a natural-language prompt into a sequence of
 * validated browser actions, with AI-powered planning and structured
 * error recovery.
 */

export { AgentEngine } from './engine';
export type { AgentRunResult, ExecutionResult, PermissionDecision, AgentEngineOptions } from './engine';

export { validateAction, validatePlan } from './validator';
export type { ValidationResult, ValidationSuccess, ValidationFailure } from './validator';

export { replanForFailure, degradeLocator } from './replanner';

export {
  createInitialState,
  advanceState,
  recordError,
  stepsRemaining,
  nextSequence,
  actionRecordId,
  taskIdForSequence,
} from './state';

export {
  observePage,
  summarizeExtraction,
  summarizeDownload,
} from './observer';
