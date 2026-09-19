import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { AgentEvent, DownloadRecord, PermissionRequest, Task } from "@webpilot/schemas";
import { TaskForm } from "~/components/TaskForm";
import { Timeline } from "~/components/Timeline";
import { PermissionPrompt } from "~/components/PermissionPrompt";
import { DownloadLibrary } from "~/components/DownloadLibrary";
import { api, type BrowserStatus, type ModelStatus, type SettingsSnapshot } from "~/lib/api";
import { subscribeToTask } from "~/lib/events";

const POLL_MS = 1_500;

function isTerminal(status: Task["status"] | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export default function Home() {
  const [task, setTask] = createSignal<Task | null>(null);
  const [events, setEvents] = createSignal<AgentEvent[]>([]);
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([]);
  const [downloads, setDownloads] = createSignal<DownloadRecord[]>([]);
  const [model, setModel] = createSignal<ModelStatus | null>(null);
  const [browser, setBrowser] = createSignal<BrowserStatus | null>(null);
  const [settings, setSettings] = createSignal<SettingsSnapshot | null>(null);
  const [recent, setRecent] = createSignal<Task[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [streamStatus, setStreamStatus] = createSignal<string | null>(null);

  let unsubscribe: (() => void) | undefined;
  let pollTimer: number | undefined;

  /** Live socket + immediate snapshot for one task. */
  async function watch(taskId: string) {
    unsubscribe?.();
    unsubscribe = subscribeToTask(taskId, {
      onEvent: (event) =>
        setEvents((previous) => {
          if (previous.some((existing) => existing.sequence === event.sequence)) return previous;
          return [...previous, event].sort((a, b) => a.sequence - b.sequence);
        }),
      onStatus: (status) => setStreamStatus(status),
    });
    await refreshRunState(taskId);
  }

  /** Permissions, downloads and task state (the socket only carries events). */
  async function refreshRunState(taskId: string) {
    try {
      const [taskResponse, permissionResponse, downloadResponse] = await Promise.all([
        api.getTask(taskId),
        api.pendingPermissions(taskId),
        api.listDownloads(taskId),
      ]);
      setTask(taskResponse.task);
      setPermissions(permissionResponse.permissions);
      setDownloads(downloadResponse.downloads);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh the task.");
    }
  }

  function stopPolling() {
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    pollTimer = undefined;
  }

  function startPolling(taskId: string) {
    stopPolling();
    pollTimer = window.setInterval(() => {
      void refreshRunState(taskId).then(() => {
        if (isTerminal(task()?.status) && permissions().length === 0) {
          stopPolling();
          void refreshSystem();
        }
      });
    }, POLL_MS);
  }

  async function refreshSystem() {
    try {
      const [modelResponse, browserResponse, settingsResponse, tasksResponse] = await Promise.all([
        api.modelStatus(),
        api.browserStatus(),
        api.settings(),
        api.listTasks(5),
      ]);
      setModel(modelResponse.model);
      setBrowser(browserResponse.browser);
      setSettings(settingsResponse.settings);
      setRecent(tasksResponse.tasks);
    } catch {
      // The system panel is informational: a failure must not block the task UI.
    }
  }

  async function handleSubmit(prompt: string) {
    setError(null);
    setEvents([]);
    setPermissions([]);
    setDownloads([]);

    const created = await api.createTask(prompt);
    setTask(created.task);
    await watch(created.task.id);
    startPolling(created.task.id);
  }

  async function handleDecide(
    permissionId: string,
    decision: { grant: boolean; remember?: boolean },
  ) {
    const active = task();
    if (!active) return;
    await api.decidePermission(active.id, permissionId, decision);
    await refreshRunState(active.id);
  }

  async function handleCancel() {
    const active = task();
    if (!active) return;
    try {
      await api.cancelTask(active.id);
      await refreshRunState(active.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel the task.");
    }
  }

  onMount(() => {
    void refreshSystem().then(async () => {
      const latest = recent()[0];
      if (!latest) return;
      // Resume the most recent run so a reload shows the real state.
      setTask(latest);
      await watch(latest.id);
      if (!isTerminal(latest.status)) startPolling(latest.id);
    });
  });

  onCleanup(() => {
    unsubscribe?.();
    stopPolling();
  });

  const aiMode = () => {
    const status = model()?.status;
    if (!model()) return "checking…";
    if (status === "disabled") return "disabled (WEBPILOT_AI_ENABLED=false)";
    if (status === "loaded") return `local model loaded (${model()?.modelId})`;
    if (status === "not-loaded") return "local model available (loads on first plan)";
    return "rule-based planner (model unavailable)";
  };

  return (
    <main id="main" class="site-main" tabindex="-1">
      <section class="intro" id="intro" aria-labelledby="intro-heading">
        <h1 id="intro-heading">A local dashboard for a local agent</h1>
        <p class="lede max-w-prose">
          Describe what you want from the web. WebPilot plans, browses, extracts
          and downloads on this machine — no cloud calls, no telemetry, no data
          leaving your device.
        </p>
        <p class="system-line">
          <span class="system-chip">AI: {aiMode()}</span>
          <span class="system-chip">
            Browser: {browser()?.engine ?? "chromium"} ·{" "}
            {browser()?.headless === false ? "visible" : "headless"} ·{" "}
            {browser()?.status ?? "stopped"}
          </span>
          <Show when={settings()}>
            {(current) => (
              <span class="system-chip">
                Limits: {current().limits.maxAgentSteps} steps ·{" "}
                {current().limits.maxDownloads} files · {current().limits.maxFileSizeMb} MB
              </span>
            )}
          </Show>
        </p>
        <Show when={error()}>
          {(message) => (
            <p class="field-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </section>

      <PermissionPrompt permissions={permissions()} onDecide={handleDecide} />

      <div class="panel-grid">
        <section class="panel" id="task" aria-labelledby="task-heading">
          <p class="panel-label">
            <Show when={task()} fallback="Ready">
              {(active) => (
                <>
                  {active().id} · {active().status}
                </>
              )}
            </Show>
          </p>
          <h2 id="task-heading">Task</h2>

          <Show when={task()}>
            {(active) => (
              <dl class="task-stats">
                <div>
                  <dt>Steps</dt>
                  <dd>{active().stepCount}</dd>
                </div>
                <div>
                  <dt>Downloads</dt>
                  <dd>{active().downloadsCount}</dd>
                </div>
                <div>
                  <dt>Page</dt>
                  <dd class="task-url">{active().currentUrl ?? "—"}</dd>
                </div>
              </dl>
            )}
          </Show>

          <TaskForm onSubmit={handleSubmit} />

          <Show when={task() !== null && !isTerminal(task()?.status)}>
            <div class="task-form-actions">
              <button type="button" class="button-secondary" onClick={() => void handleCancel()}>
                Cancel task
              </button>
            </div>
          </Show>

          <Show when={task()?.error}>
            {(message) => (
              <p class="field-error" role="alert">
                {message()}
              </p>
            )}
          </Show>

          <Show when={recent().length > 0}>
            <div class="recent">
              <h3>Recent runs</h3>
              <ul class="recent-list">
                <For each={recent()}>
                  {(entry) => (
                    <li>
                      <button
                        type="button"
                        class="recent-link"
                        onClick={() => {
                          setEvents([]);
                          setTask(entry);
                          void watch(entry.id);
                        }}
                      >
                        <span class="recent-id">{entry.id}</span>{" "}
                        <span class={`status status-${entry.status}`}>{entry.status}</span>
                        <span class="recent-prompt">{entry.prompt}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </section>

        <Timeline events={events()} taskId={task()?.id ?? null} streamStatus={streamStatus()} />

        <DownloadLibrary downloads={downloads()} />
      </div>
    </main>
  );
}