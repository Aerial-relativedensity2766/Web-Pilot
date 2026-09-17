import { z } from 'zod';
import { ACTION_CAPS } from './limits';
import { ActionSchema } from './actions';

export const TASK_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TaskStatusSchema = z.enum(TASK_STATUSES);

export const CreateTaskRequestSchema = z.strictObject({
  prompt: z.string().trim().min(3).max(2_000),
  /** start the run immediately (default true) */
  autoRun: z.boolean().optional(),
});

export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const TaskSchema = z.strictObject({
  id: z.string(),
  prompt: z.string(),
  goal: z.string().optional(),
  status: TaskStatusSchema,
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  stepCount: z.number().int().min(0),
  downloadsCount: z.number().int().min(0),
  currentUrl: z.string().nullable().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const ActionResultSchema = z.strictObject({
  ok: z.boolean(),
  /** short machine readable outcome, e.g. `images_found` */
  summary: z.string().optional(),
  detail: z.string().optional(),
  data: z.unknown().optional(),
  errorCode: z.string().optional(),
  recoverable: z.boolean().optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

export const AgentActionRecordSchema = z.strictObject({
  id: z.string(),
  taskId: z.string(),
  sequence: z.number().int().min(0),
  type: z.string(),
  target: z.string().nullable().optional(),
  arguments: z.string(),
  status: z.enum(['planned', 'running', 'completed', 'failed', 'rejected', 'skipped']),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type AgentActionRecord = z.infer<typeof AgentActionRecordSchema>;

/**
 * A plan is an ordered list of validated actions plus the goal the planner
 * derived from the natural-language prompt.
 */
export const TaskPlanSchema = z.strictObject({
  goal: z.string().min(1).max(400),
  steps: z.array(ActionSchema).min(1).max(ACTION_CAPS.planSteps),
  /** `rule` = deterministic intent parser, `ai` = Qwen produced the plan */
    source: z.enum(['rule', 'ai', 'replan']).default('rule'),
  /** soft warnings surfaced by the planner (e.g. rejected steps) */
  warnings: z.array(z.string()).default([]),
  createdAt: z.string(),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;
