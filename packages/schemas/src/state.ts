import { z } from 'zod';
import { ActionSchema } from './actions';
import { WebPilotErrorSchema } from './errors';
import { RankedItemSchema } from './page';

/**
 * Everything the agent knows about the current run.
 *
 * This is deliberately small: it is the only agent-side object that may be
 * serialized into the AI context, which keeps inference cheap and prevents the
 * model from re-discovering facts it already observed.
 */
export const AgentStateSchema = z.strictObject({
  taskId: z.string(),
  goal: z.string(),
  currentUrl: z.string().nullable(),
  pageTitle: z.string(),
  /** candidates seen on the current/last page, best first */
  candidates: z.array(RankedItemSchema),
  /** the subset the agent decided to act on */
  selected: z.array(RankedItemSchema),
  /** URLs already downloaded successfully */
  downloaded: z.array(z.string()),
  /** how many more resources the task needs */
  remaining: z.number().int().min(0),
  step: z.number().int().min(0),
  maxSteps: z.number().int().min(1),
  lastAction: ActionSchema.nullable(),
  lastActionSummary: z.string().nullable(),
  lastResultSummary: z.string().nullable(),
  errors: z.array(WebPilotErrorSchema),
  aiAvailable: z.boolean(),
  startedAt: z.string(),
  updatedAt: z.string(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

export const PERMISSION_KINDS = [
  'download',
  'file_upload',
  'file_delete',
  'form_submission',
  'consequential_click',
  'purchase',
] as const;

export type PermissionKind = (typeof PERMISSION_KINDS)[number];
export const PermissionKindSchema = z.enum(PERMISSION_KINDS);

export const PERMISSION_STATUSES = ['pending', 'granted', 'denied', 'expired'] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];
export const PermissionStatusSchema = z.enum(PERMISSION_STATUSES);

export const PermissionRequestSchema = z.strictObject({
  id: z.string(),
  taskId: z.string(),
  kind: PermissionKindSchema,
  title: z.string(),
  description: z.string(),
  /** the exact action awaiting approval, for the audit trail */
  action: ActionSchema.optional(),
  itemCount: z.number().int().min(0).optional(),
  estimatedBytes: z.number().int().min(0).optional(),
  status: PermissionStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().nullable().optional(),
});

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

export const DecidePermissionRequestSchema = z.strictObject({
  grant: z.boolean(),
  /** optional "always allow this kind for this task" flag */
  remember: z.boolean().optional(),
});

export type DecidePermissionRequest = z.infer<typeof DecidePermissionRequestSchema>;