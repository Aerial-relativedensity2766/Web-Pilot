import { Show, createSignal } from "solid-js";

/**
 * The task input.
 *
 * Accessibility notes: a real `<form>` (Enter submits), an explicit label, the
 * note wired with `aria-describedby`, inline validation errors announced with
 * `role="alert"`, and a visible disabled/loading state.
 */
export interface TaskFormProps {
  onSubmit: (prompt: string) => Promise<void> | void;
  disabled?: boolean;
  example?: string;
}

const MIN_LENGTH = 3;

export function TaskForm(props: TaskFormProps) {
  const [prompt, setPrompt] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const value = prompt().trim();

    if (value.length < MIN_LENGTH) {
      setError(`Describe the task in at least ${MIN_LENGTH} characters.`);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await props.onSubmit(value);
      setPrompt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the task.");
    } finally {
      setBusy(false);
    }
  }

  const isDisabled = () => busy() || props.disabled === true;

  return (
    <form class="task-form" onSubmit={handleSubmit} novalidate>
      <div class="field">
        <label for="task-prompt">What should the agent do?</label>
        <textarea
          id="task-prompt"
          name="prompt"
          value={prompt()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          disabled={isDisabled()}
          aria-describedby="task-prompt-note"
          aria-invalid={error() ? "true" : undefined}
          placeholder={props.example ?? "download 3 images of trees from https://example.com"}
        />
        <p class="field-note" id="task-prompt-note">
          Runs locally in a fresh browser profile. Downloads are verified against
          their real file type before they are saved, and sensitive actions ask
          you first.
        </p>
      </div>

      <Show when={error()}>
        {(message) => (
          <p class="field-error" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <div class="task-form-actions">
        <button type="submit" class="button-primary" disabled={isDisabled()}>
          {busy() ? "Starting…" : "Run task"}
        </button>
        <span class="field-note" aria-live="polite">
          {busy() ? "Handing the task to the local agent…" : ""}
        </span>
      </div>
    </form>
  );
}