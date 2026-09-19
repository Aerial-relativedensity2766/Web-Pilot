import { For, type ParentProps } from "solid-js";
import logoUrl from "../../../../docs/web-pilot.png";

const navItems = [
  { href: "/#intro", label: "Introduction" },
  { href: "/#task", label: "Task" },
  { href: "/#timeline", label: "Timeline" },
  { href: "/#downloads", label: "Downloads" }
] as const;

export function SiteChrome(props: ParentProps) {
  return (
    <>
      <header class="site-header">
        <a class="brand" href="/#intro">
          <img
            class="brand-mark"
            src={logoUrl}
            alt=""
            width="52"
            height="52"
          />
          <span class="brand-text">
            <span class="brand-name">WebPilot</span>
            <span class="preview-badge">Local dashboard</span>
          </span>
        </a>
        <nav class="site-nav" aria-label="Dashboard sections">
          <ul>
            <For each={navItems}>
              {(item) => (
                <li>
                  <a href={item.href}>{item.label}</a>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </header>
      {props.children}
      <footer class="site-footer">
        <p>
          Runs entirely on this machine: no analytics, hosted fonts, or cloud
          APIs. Files are saved under <code>data/downloads/</code> and never
          uploaded.
        </p>
      </footer>
    </>
  );
}
