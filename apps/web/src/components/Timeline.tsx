import { For, Show } from "solid-js";
import type { AgentEvent } from "@webpilot/schemas";

/** Maps an event type to a CSS modifier so severity is visible, not just textual. */
function levelClass(event: AgentEvent): string {
  if (event.level === "error") return "timeline-item timeline-item-error";
  if (event.level === "warn") return "timeline-item timeline-item-warn";
  return "timeline-item";
}

function timeOf(event: AgentEvent): string {
  const date = new Date(event.at);
  return Number.isNaN(date.getTime()) ? event.at : date.toLocaleTimeString();
}

export interface TimelineProps {
  events: AgentEvent[];
  /** `null` while nothing has run yet. */
  taskId: string | null;
  streamStatus: string | null;
}

/**
 * The live agent timeline: one row per structured event, in the order the engine
 * produced them (sequences are monotonic, so no client-side sorting is needed).
 */
export function Timeline(props: TimelineProps) {
  return (
    <section class="panel" id="timeline" aria-labelledby="timeline-heading">
      <p class="panel-label">
        <Show when={props.taskId} fallback="No task yet">
          {props.taskId} · {props.streamStatus === "open" ? "live" : (props.streamStatus ?? "idle")}
        </Show>
      </p>
      <h2 id="timeline-heading">Timeline</h2>

      <Show
        when={props.events.length > 0}
        fallback={
          <>
            <p class="empty-copy">
              Agent events stream here as the run progresses. Nothing is running
              right now.
            </p>
            <ul class="empty-list">
              <li>No planned actions</li>
              <li>No live status</li>
            </ul>
          </>
        }
      >
        <ol class="timeline" aria-label="Agent events">
          <For each={props.events}>
            {(event) => (
              <li class={levelClass(event)}>
                <span class="timeline-seq" aria-hidden="true">
                  {String(event.sequence).padStart(2, "0")}
                </span>
                <span class="timeline-body">
                  <span class="timeline-type">{event.type}</span>
                  <span class="timeline-message">{event.message}</span>
                  <span class="timeline-time">{timeOf(event)}</span>
                </span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </section>
  );
}