import { For, Show, createSignal } from "solid-js";
import type { PermissionRequest } from "@webpilot/schemas";

/**
 * The human permission gate.
 *
 * Sensitive actions (form submissions, consequential clicks, bulk downloads)
 * pause the agent until a person decides. Each choice is explicit: allow once,
 * allow for this task, or deny. Nothing is pre-selected and nothing times out
 * silently — if nobody answers, the agent stops.
 */
export interface PermissionPromptProps {
  permissions: PermissionRequest[];
  onDecide: (
    permissionId: string,
    decision: { grant: boolean; remember?: boolean },
  ) => Promise<void> | void;
}

export function PermissionPrompt(props: PermissionPromptProps) {
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function decide(
    permissionId: string,
    decision: { grant: boolean; remember?: boolean },
  ) {
    setBusyId(permissionId);
    setError(null);
    try {
      await props.onDecide(permissionId, decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the decision.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Show when={props.permissions.length > 0}>
      <div class="permission" role="alertdialog" aria-labelledby="permission-heading">
        <h2 id="permission-heading">Permission required</h2>
        <p class="empty-copy">
          The agent paused before doing something consequential. Nothing happens
          until you choose.
        </p>

        <For each={props.permissions}>
          {(permission) => (
            <div class="permission-item">
              <p class="permission-title">
                <strong>{permission.title}</strong>{" "}
                <span class="permission-kind">{permission.kind}</span>
              </p>
              <p class="permission-description">{permission.description}</p>
              <div class="permission-actions">
                <button
                  type="button"
                  class="button-primary"
                  disabled={busyId() === permission.id}
                  onClick={() => void decide(permission.id, { grant: true })}
                >
                  Allow once
                </button>
                <button
                  type="button"
                  class="button-secondary"
                  disabled={busyId() === permission.id}
                  onClick={() => void decide(permission.id, { grant: true, remember: true })}
                >
                  Allow for this task
                </button>
                <button
                  type="button"
                  class="button-danger"
                  disabled={busyId() === permission.id}
                  onClick={() => void decide(permission.id, { grant: false })}
                >
                  Deny
                </button>
              </div>
            </div>
          )}
        </For>

        <Show when={error()}>
          {(message) => (
            <p class="field-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </div>
    </Show>
  );
}