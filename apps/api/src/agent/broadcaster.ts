/**
 * WebSocket fan-out for agent events.
 *
 * Kept separate from Elysia so the routing layer stays thin and this logic is
 * unit-testable with plain functions as senders. Messages use the
 * `WebSocketMessageSchema` envelope from `@webpilot/schemas`, so the dashboard
 * and the API agree on one wire format (no ad-hoc frames).
 */
import type { AgentEvent, WebPilotError, WebSocketMessage } from '@webpilot/schemas';
import { nowIso } from '@webpilot/shared';

export type MessageSender = (message: WebSocketMessage) => void;

interface Client {
  sender: MessageSender;
  taskId: string | null;
}

export class EventBroadcaster {
  private readonly clients = new Set<Client>();

  /**
   * Registers a client. `taskId = null` subscribes to every task's events
   * (used by a future global activity feed).
   */
  subscribe(sender: MessageSender, taskId: string | null = null): () => void {
    const client: Client = { sender, taskId };
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  /** Sends `hello` so the client knows who answered and when. */
  hello(sender: MessageSender, taskId: string): void {
    this.safeSend(sender, { kind: 'hello', taskId, at: nowIso() });
  }

  /** Fan-out of one agent event; returns how many clients received it. */
  publish(event: AgentEvent): number {
    let delivered = 0;
    for (const client of [...this.clients]) {
      if (client.taskId !== null && client.taskId !== event.taskId) continue;
      if (this.safeSend(client.sender, { kind: 'event', event })) delivered += 1;
    }
    return delivered;
  }

  publishTask(taskId: string, task: unknown): number {
    let delivered = 0;
    for (const client of [...this.clients]) {
      if (client.taskId !== null && client.taskId !== taskId) continue;
      if (this.safeSend(client.sender, { kind: 'task', task })) delivered += 1;
    }
    return delivered;
  }

  publishError(sender: MessageSender, error: WebPilotError): void {
    this.safeSend(sender, { kind: 'error', error });
  }

  pong(sender: MessageSender): void {
    this.safeSend(sender, { kind: 'pong', at: nowIso() });
  }

  /** Number of subscribers, optionally for one task. */
  count(taskId?: string): number {
    if (!taskId) return this.clients.size;
    return [...this.clients].filter((client) => client.taskId === taskId).length;
  }

  clear(): void {
    this.clients.clear();
  }

  /** A throwing sender is dropped instead of breaking the fan-out. */
  private safeSend(sender: MessageSender, message: WebSocketMessage): boolean {
    try {
      sender(message);
      return true;
    } catch {
      for (const client of [...this.clients]) {
        if (client.sender === sender) this.clients.delete(client);
      }
      return false;
    }
  }
}

export function createEventBroadcaster(): EventBroadcaster {
  return new EventBroadcaster();
}