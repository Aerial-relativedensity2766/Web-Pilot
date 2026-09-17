import { WebPilotError } from '@webpilot/schemas';

/**
 * Cooperative cancellation.
 *
 * The API aborts a run by cancelling its token; every long running step
 * (navigation, download loop, agent iteration) calls `throwIfCancelled()` so
 * the task stops promptly instead of at an arbitrary boundary.
 */
export class CancellationToken {
  private cancelled = false;
  private reason: string | null = null;
  private readonly listeners = new Set<(reason: string) => void>();

  get isCancelled(): boolean {
    return this.cancelled;
  }

  get cancelReason(): string | null {
    return this.reason;
  }

  cancel(reason = 'cancelled by user'): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.reason = reason;
    for (const listener of this.listeners) {
      try {
        listener(reason);
      } catch {
        // listeners must never break cancellation
      }
    }
    this.listeners.clear();
  }

  onCancel(listener: (reason: string) => void): () => void {
    if (this.cancelled) {
      listener(this.reason ?? 'cancelled');
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new WebPilotError('TASK_CANCELLED', this.reason ?? 'Task cancelled', {
        recoverable: false,
      });
    }
  }
}

export function createCancellationToken(): CancellationToken {
  return new CancellationToken();
}