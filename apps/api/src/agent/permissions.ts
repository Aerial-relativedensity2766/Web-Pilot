/**
 * The human permission gate.
 *
 * An agent that drives a real browser and writes real files must not decide on
 * its own when something is consequential. The engine asks here and **waits**;
 * the API exposes the request over REST/WebSocket and the dashboard answers it.
 *
 * Fail-closed: if nobody answers (task cancelled, server shutting down, client
 * gone), `denyAll` resolves every outstanding request with a denial — the agent
 * aborts instead of silently proceeding.
 */
import type { PermissionKind, PermissionRequest } from '@webpilot/schemas';
import { WebPilotError } from '@webpilot/schemas';
import { permissionId } from '@webpilot/shared';
import type { PermissionDecision } from '@webpilot/agent-core';

interface PendingPermission {
  request: PermissionRequest;
  settle: (decision: PermissionDecision) => void;
}

export class PermissionBroker {
  private readonly pending = new Map<string, PendingPermission>();
  /** `taskId` → kinds the user chose to always allow for that task. */
  private readonly remembered = new Map<string, Set<PermissionKind>>();
  /** `taskId`s that had at least one permission denied. */
  private readonly denied = new Set<string>();

  /** Creates a request and returns a promise that settles when a human decides. */
  request(taskId: string, request: PermissionRequest): Promise<PermissionDecision> {
    const remembered = this.remembered.get(taskId);
    if (remembered?.has(request.kind)) {
      return Promise.resolve({ granted: true, remember: true });
    }

    const id = request.id || permissionId();
    return new Promise<PermissionDecision>((resolve) => {
      this.pending.set(id, {
        request: { ...request, id, taskId, status: 'pending' },
        settle: resolve,
      });
    });
  }

  /** Answers a pending request. Returns false when it is unknown or already settled. */
  resolve(permissionIdValue: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(permissionIdValue);
    if (!entry) return false;
    this.pending.delete(permissionIdValue);

    if (!decision.granted) this.denied.add(entry.request.taskId);
    if (decision.granted && decision.remember) {
      const kinds = this.remembered.get(entry.request.taskId) ?? new Set<PermissionKind>();
      kinds.add(entry.request.kind);
      this.remembered.set(entry.request.taskId, kinds);
    }

    entry.settle(decision);
    return true;
  }

  /** Pending requests, optionally limited to one task. */
  list(taskId?: string): PermissionRequest[] {
    return [...this.pending.values()]
      .map((entry) => entry.request)
      .filter((request) => (taskId ? request.taskId === taskId : true));
  }

  get(taskId: string, permissionIdValue: string): PermissionRequest | null {
    const entry = this.pending.get(permissionIdValue);
    if (!entry || entry.request.taskId !== taskId) return null;
    return entry.request;
  }

  /** Denies every outstanding request (task cancelled, server shutting down). */
  denyAll(taskId?: string, reason = 'denied: no human decision'): number {
    let denied = 0;
    for (const [id, entry] of [...this.pending.entries()]) {
      if (taskId && entry.request.taskId !== taskId) continue;
      this.pending.delete(id);
      denied += 1;
      this.denied.add(entry.request.taskId);
      entry.settle({ granted: false });
    }
    if (denied > 0) this.lastReason = reason;
    return denied;
  }

  get size(): number {
    return this.pending.size;
  }

  /** Why the last `denyAll` fired — surfaced in logs, never in API responses. */
  lastReason: string | null = null;

  /** Whether any permission was denied for this task (resolved or denyAll). */
  hasDenied(taskId: string): boolean {
    return this.denied.has(taskId);
  }

  /** Rejects the run if a permission is required but no handler exists. */
  static unavailable(kind: PermissionKind): WebPilotError {
    return new WebPilotError(
      'PERMISSION_DENIED',
      `Permission required for ${kind} but no handler is configured`,
      { recoverable: false },
    );
  }
}