import { A } from "@solidjs/router";

export default function NotFound() {
  return (
    <main id="main" class="site-main not-found" tabindex="-1">
      <h1>Page not found</h1>
      <p class="lede">
        That address is not part of this dashboard preview.
      </p>
      <p>
        <A href="/">Return to the dashboard preview</A>
      </p>
    </main>
  );
}
