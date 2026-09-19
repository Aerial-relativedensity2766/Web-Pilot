/**
 * One monotonic, validated event stream per task.
 *
 * The `AgentEngine` emits events with its own sequence numbers, and the API adds
 * a few of its own (`TASK_QUEUED`, `BROWSER_STATUS`, `TASK_COMPLETED`). If both
 * counted independently the timeline would have duplicate sequences and the UI
 * could not order or resume it. So every event that leaves the engine is
 * re-sequenced here: exactly one counter per task, no gaps, no duplicates.
 */
import type { AgentEvent, AgentEventType, LogLevel } from '@webpilot/schemas';
import { eventId, nowIso } from '@webpilot/shared';

/** The serialisable error payload carried by `AgentEvent.error`. */
type AgentEventError = NonNullable<AgentEvent['error']>;

export type EventSink = (event: AgentEvent) => void;

export class TaskChannel {
  private sequence = 0;
  private readonly sinks = new Set<EventSink>();

  constructor(
    readonly taskId: string,
    private readonly onEvent: EventSink = () => undefined,
  ) {}

  /** Registers a sink; returns an unsubscribe function. */
  subscribe(sink: EventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  get lastSequence(): number {
    return this.sequence;
  }

  /** Emits a new event owned by the API (task queueing, browser status, …). */
  emit(
    type: AgentEventType,
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: AgentEventError,
  ): AgentEvent {
    return this.publish({
      type,
      level,
      message,
      ...(data ? { data } : {}),
      ...(error ? { error } : {}),
    });
  }

  /** Re-sequences an event produced by the agent engine. */
  accept(event: AgentEvent): AgentEvent {
    return this.publish({
      type: event.type,
      level: event.level,
      message: event.message,
      ...(event.data ? { data: event.data } : {}),
      ...(event.error ? { error: event.error } : {}),
    });
  }

  private publish(input: {
    type: AgentEventType;
    level: LogLevel;
    message: string;
    data?: Record<string, unknown>;
    error?: AgentEventError;
  }): AgentEvent {
    this.sequence += 1;
    const event: AgentEvent = {
      id: eventId(this.taskId, this.sequence),
      taskId: this.taskId,
      type: input.type,
      sequence: this.sequence,
      level: input.level,
      message: input.message,
      ...(input.data ? { data: input.data } : {}),
      ...(input.error ? { error: input.error } : {}),
      at: nowIso(),
    };

    this.onEvent(event);
    for (const sink of [...this.sinks]) {
      try {
        sink(event);
      } catch {
        // a broken subscriber (closed socket) must never break the agent loop
      }
    }
    return event;
  }
}

export function createTaskChannel(taskId: string, onEvent?: EventSink): TaskChannel {
  return new TaskChannel(taskId, onEvent);
}