import { z } from 'zod';
import { WebPilotErrorSchema } from './errors';

/**
 * The complete WebSocket / timeline event vocabulary.
 * `sequence` is monotonic per task so the UI can order events deterministically.
 */
export const AGENT_EVENT_TYPES = [
  'TASK_QUEUED',
  'TASK_STARTED',
  'AI_THINKING',
  'AI_UNAVAILABLE',
  'PLAN_CREATED',
  'ACTION_PLANNED',
  'ACTION_STARTED',
  'ACTION_COMPLETED',
  'ACTION_FAILED',
  'ACTION_REJECTED',
  'PAGE_CHANGED',
  'ITEM_FOUND',
  'ITEMS_RANKED',
  'DOWNLOAD_STARTED',
  'DOWNLOAD_COMPLETED',
  'DOWNLOAD_FAILED',
  'PERMISSION_REQUESTED',
  'PERMISSION_GRANTED',
  'PERMISSION_DENIED',
  'TASK_COMPLETED',
  'TASK_FAILED',
  'TASK_CANCELLED',
  'LOG',
  'BROWSER_STATUS',
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const AgentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export const LogLevelSchema = z.enum(LOG_LEVELS);

export const AgentEventSchema = z.strictObject({
  id: z.string(),
  taskId: z.string(),
  type: AgentEventTypeSchema,
  sequence: z.number().int().min(0),
  level: LogLevelSchema,
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: WebPilotErrorSchema.optional(),
  at: z.string(),
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Envelope sent over `/ws/tasks/:id`. */
export const WebSocketMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hello'), taskId: z.string(), at: z.string() }),
  z.strictObject({ kind: z.literal('event'), event: AgentEventSchema }),
  z.strictObject({ kind: z.literal('task'), task: z.unknown() }),
  z.strictObject({ kind: z.literal('error'), error: WebPilotErrorSchema }),
  z.strictObject({ kind: z.literal('pong'), at: z.string() }),
]);

export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;

export const BROWSER_STATUSES = ['stopped', 'launching', 'ready', 'closing', 'error'] as const;
export type BrowserStatus = (typeof BROWSER_STATUSES)[number];
export const BrowserStatusSchema = z.enum(BROWSER_STATUSES);