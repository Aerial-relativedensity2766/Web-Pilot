/**
 * Live agent timeline over WebSocket.
 *
 * The API replays the persisted history on connect, so a reload (or a crash)
 * never loses the story — the client just keeps appending. Reconnects with a
 * small backoff; the socket is closed deterministically on cleanup.
 */
import type { AgentEvent, WebSocketMessage } from "@webpilot/schemas";
import { eventsUrl } from "./api";

export type StreamStatus = "connecting" | "open" | "closed" | "error";

export interface EventStreamHandlers {
  onEvent: (event: AgentEvent) => void;
  onStatus?: (status: StreamStatus) => void;
}

/**
 * Subscribes to one task's events. Returns an unsubscribe function.
 * Must be called from the client (it is only invoked inside `onMount`).
 */
export function subscribeToTask(taskId: string, handlers: EventStreamHandlers): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let retryTimer: number | undefined;

  const connect = (): void => {
    if (stopped) return;
    handlers.onStatus?.("connecting");

    socket = new WebSocket(eventsUrl(taskId));

    socket.onopen = () => {
      attempts = 0;
      handlers.onStatus?.("open");
    };

    socket.onmessage = (raw: MessageEvent) => {
      let parsed: WebSocketMessage;
      try {
        parsed = JSON.parse(String(raw.data)) as WebSocketMessage;
      } catch {
        return;
      }
      if (parsed.kind === "event") handlers.onEvent(parsed.event);
    };

    socket.onerror = () => handlers.onStatus?.("error");

    socket.onclose = () => {
      handlers.onStatus?.("closed");
      if (stopped) return;
      attempts += 1;
      retryTimer = window.setTimeout(connect, Math.min(5_000, 400 * attempts));
    };
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    socket?.close();
    socket = null;
  };
}