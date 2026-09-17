import { nowIso } from '@webpilot/shared';
import { actionId, taskIdFromSequence } from '@webpilot/shared';
import type { Action, AgentState, RankedItem } from '@webpilot/schemas';

/** Creates the initial agent state for a new task run. */
export function createInitialState(input: {
  taskId: string;
  goal: string;
  maxSteps: number;
  aiAvailable: boolean;
}): AgentState {
  const now = nowIso();
  return {
    taskId: input.taskId,
    goal: input.goal,
    currentUrl: null,
    pageTitle: '',
    candidates: [],
    selected: [],
    downloaded: [],
    remaining: 0,
    step: 0,
    maxSteps: input.maxSteps,
    lastAction: null,
    lastActionSummary: null,
    lastResultSummary: null,
    errors: [],
    aiAvailable: input.aiAvailable,
    startedAt: now,
    updatedAt: now,
  };
}

export function nextSequence(state: AgentState): number {
  return state.step + 1;
}

/** Immutable state transition after a successful step. */
export function advanceState(
  state: AgentState,
  update: {
    action: Action;
    actionSummary: string;
    resultSummary: string;
    currentUrl?: string | null;
    pageTitle?: string;
    candidates?: RankedItem[];
    selected?: RankedItem[];
    downloaded?: string[];
    remaining?: number;
  },
): AgentState {
  return {
    ...state,
    currentUrl: update.currentUrl ?? state.currentUrl,
    pageTitle: update.pageTitle ?? state.pageTitle,
    candidates: update.candidates ?? state.candidates,
    selected: update.selected ?? state.selected,
    downloaded: update.downloaded ?? state.downloaded,
    remaining: update.remaining ?? state.remaining,
    step: state.step + 1,
    lastAction: update.action,
    lastActionSummary: update.actionSummary,
    lastResultSummary: update.resultSummary,
    updatedAt: nowIso(),
  };
}

/** Immutable transition recording a recoverable failure (step still counts). */
export function recordError(
  state: AgentState,
  error: AgentState['errors'][number],
  action?: Action,
): AgentState {
  return {
    ...state,
    step: state.step + 1,
    lastAction: action ?? state.lastAction,
    errors: [...state.errors, error].slice(-20),
    updatedAt: nowIso(),
  };
}

export function stepsRemaining(state: AgentState): boolean {
  return state.step < state.maxSteps;
}

export function actionRecordId(taskId: string, sequence: number): string {
  return actionId(taskId, sequence);
}

export function taskIdForSequence(sequence: number): string {
  return taskIdFromSequence(sequence);
}
