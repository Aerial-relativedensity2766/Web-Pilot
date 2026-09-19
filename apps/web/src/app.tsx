import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense, type ParentProps } from "solid-js";
import "virtual:uno.css";
import "./app.css";
import { SiteChrome } from "~/components/SiteChrome";

function RootLayout(props: ParentProps) {
  return (
    <>
      <a class="skip-link" href="#main">
        Skip to main content
      </a>
      <SiteChrome>
        <Suspense>{props.children}</Suspense>
      </SiteChrome>
    </>
  );
}

export default function App() {
  return (
    <Router root={RootLayout}>
      <FileRoutes />
    </Router>
  );
}
