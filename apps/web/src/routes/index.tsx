export default function Home() {
  return (
    <main id="main" class="site-main" tabindex="-1">
      <section class="intro" id="intro" aria-labelledby="intro-heading">
        <h1 id="intro-heading">A local dashboard for a local agent</h1>
        <p class="lede max-w-prose">
          WebPilot turns natural-language tasks into safe, structured browser
          actions on your machine. This page is the first dashboard shell: a
          place to learn what the product is, and where tasks, the agent
          timeline, and downloads will live later.
        </p>
        <div class="notice" role="note">
          <strong>Live task execution is not connected yet.</strong>
          This is a static preview of the layout. Nothing on this page starts
          an agent, streams events, or downloads files.
        </div>
      </section>

      <div class="panel-grid">
        <section class="panel" id="task" aria-labelledby="task-heading">
          <p class="panel-label">Preview</p>
          <h2 id="task-heading">Task</h2>
          <p class="empty-copy">
            Future task input will go here once the local API exists. The field
            below is a labeled preview only.
          </p>
          <div class="field">
            <label for="task-preview">Future task prompt (preview)</label>
            <textarea
              id="task-preview"
              disabled
              aria-disabled="true"
              aria-describedby="task-preview-note"
            >
              Example: extract product prices from https://example.com
            </textarea>
            <p class="field-note" id="task-preview-note">
              Disabled on purpose. Submitting a task is not available in this
              preview.
            </p>
          </div>
        </section>

        <section class="panel" id="timeline" aria-labelledby="timeline-heading">
          <p class="panel-label">Empty — not live</p>
          <h2 id="timeline-heading">Timeline</h2>
          <p class="empty-copy">
            Agent events will appear here after the API streams them. No
            actions are running now.
          </p>
          <ul class="empty-list">
            <li>No planned actions</li>
            <li>No live status</li>
          </ul>
        </section>

        <section class="panel" id="downloads" aria-labelledby="downloads-heading">
          <p class="panel-label">Empty — not live</p>
          <h2 id="downloads-heading">Downloads</h2>
          <p class="empty-copy">
            Downloaded files will be listed here later. This preview cannot
            start or manage downloads.
          </p>
          <ul class="empty-list">
            <li>No files in the local library</li>
            <li>No download actions</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
