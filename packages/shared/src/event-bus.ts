export type EventListener<T> = (event: T) => void;

/**
 * Tiny synchronous pub/sub used to fan agent events out to:
 *  - the WebSocket broadcaster (`/ws/tasks/:id`)
 *  - the SQLite event store
 *  - the structured logger
 *
 * Kept in `shared` so browser/agent/AI packages can emit without depending on
 * the API server (and without creating a dependency cycle).
 */
export class EventBus<T> {
  private readonly listeners = new Set<EventListener<T>>();

  get size(): number {
    return this.listeners.size;
  }

  on(listener: EventListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  once(listener: EventListener<T>): () => void {
    const off = this.on((event) => {
      off();
      listener(event);
    });
    return off;
  }

  off(listener: EventListener<T>): void {
    this.listeners.delete(listener);
  }

  emit(event: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // a broken listener must not break the emitter
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export function createEventBus<T>(): EventBus<T> {
  return new EventBus<T>();
}