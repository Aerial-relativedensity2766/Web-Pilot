import { For, Show } from "solid-js";
import type { DownloadRecord } from "@webpilot/schemas";
import { downloadFileUrl } from "../lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export interface DownloadLibraryProps {
  downloads: DownloadRecord[];
}

/**
 * The local library: every file the agent fetched, with its hash and the page it
 * came from. Files stay on disk in `data/downloads/<task>/`; this panel is the
 * window onto them, not an upload anywhere.
 */
export function DownloadLibrary(props: DownloadLibraryProps) {
  const completed = () => props.downloads.filter((entry) => entry.status === "completed");

  return (
    <section class="panel" id="downloads" aria-labelledby="downloads-heading">
      <p class="panel-label">
        {completed().length} file{completed().length === 1 ? "" : "s"} · local only
      </p>
      <h2 id="downloads-heading">Downloads</h2>

      <Show
        when={completed().length > 0}
        fallback={
          <>
            <p class="empty-copy">
              Verified files land here after a run. Nothing has been downloaded
              yet.
            </p>
            <ul class="empty-list">
              <li>No files in the local library</li>
              <li>No download actions</li>
            </ul>
          </>
        }
      >
        <ul class="download-list">
          <For each={completed()}>
            {(record) => (
              <li class="download-item">
                <a
                  class="download-link"
                  href={downloadFileUrl(record.taskId, record.filename)}
                  download={record.filename}
                >
                  {record.filename}
                </a>
                <span class="download-meta">
                  {record.mimeType} · {formatBytes(record.size)}
                  <Show when={record.sha256}>
                    {" · sha256 "}
                    {record.sha256?.slice(0, 12)}…
                  </Show>
                </span>
                <Show when={record.alt || record.sourcePage}>
                  <span class="download-source">
                    {record.alt ? `“${record.alt}”` : ""}
                    {record.alt && record.sourcePage ? " — " : ""}
                    {record.sourcePage ?? ""}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={props.downloads.some((entry) => entry.status === "failed")}>
        <div class="download-failures">
          <h3>Rejected</h3>
          <p class="field-note">
            Files that did not match their declared type are never saved — a
            mislabeled image is reported instead of stored.
          </p>
          <ul class="empty-list">
            <For each={props.downloads.filter((entry) => entry.status === "failed")}>
              {(record) => (
                <li>
                  {record.filename || record.url} — {record.error ?? "verification failed"}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}