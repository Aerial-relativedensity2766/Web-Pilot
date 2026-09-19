# Safety model

Web-Pilot is a local-first browser automation project, not a security sandbox.
Treat prompts, page content, downloaded files, and model output as untrusted.
Action validation and resource limits reduce risk, but they do not isolate the
browser or make arbitrary web content safe.

## Boundaries and limits

`agent-core` validates planned actions against the action schema and runtime
policy before execution. Navigation and download URLs must use HTTP or HTTPS.
The configured download host allowlist applies to downloads only; an empty
allowlist permits any download host, while configured hosts also match their
subdomains. Browser navigation is not restricted by that download allowlist.
There is no general outbound-network firewall.

Environment-backed limits are clamped by `packages/shared/src/config.ts`:

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| Navigation timeout | 30 s | 1–180 s |
| Action timeout | 10 s | 0.5–120 s |
| Browser tabs | 3 | 1–20 |
| Agent steps | 30 | 1–500 |
| Downloads per task | 100 | 1–1,000 |
| Download file size | 25 MiB | 1–2,048 MiB |
| Task duration | 10 min | 5 s–60 min |
| AI new tokens | 512 | 32–4,096 |

`packages/schemas/src/limits.ts` also places fixed schema caps on individual
action fields (for example, URL length 2,048, text length 2,000, plan steps 30,
and download count 200). These schema caps are not environment settings.

## Permissions

Form submissions, configured/large downloads, and clicks whose target names
look consequential (such as purchase, delete, or submit) require a permission
decision. The engine emits `PERMISSION_REQUESTED`; the host must supply the
`onPermissionRequest` callback. Without a handler, the engine denies the
request before executing the action. There is no built-in TTY prompt. A host
may choose `remember`, which caches that permission kind in memory for the
engine lifetime; it is not persisted to disk.

## Download handling

The downloader checks the per-task file count, URL scheme, and download
allowlist before fetching. It enforces response-size limits while reading,
then computes SHA-256 and inspects the bytes to infer their type. Empty payloads
and payloads that do not match an explicitly expected kind are rejected. A
server `Content-Type` mismatch is recorded but is not by itself fatal; a known
type that disagrees with the URL extension is saved with an extension derived
from the bytes. Duplicate content within a task is skipped by hash. Accepted
files and their hashes are recorded in a manifest.

These checks are not malware scanning, content sanitization, or proof that a
file is safe to open. Avoid opening untrusted downloads with privileged
applications.

## Known gaps

- Chromium is launched with `--no-sandbox`; Web-Pilot does not provide an OS
  process/container sandbox. Run it with least privilege and in an environment
  appropriate for untrusted sites.
- Page text can contain prompt-injection instructions. Validation constrains
  action shape and selected sensitive operations, but does not neutralize
  hostile page content or guarantee model intent.
- The download allowlist is not a browser-navigation or general network egress
  policy.
- The API remains a scaffold and the configured database URL has no current
  consumer. Application-level database encryption and durable permission
  storage are not implemented.

## Reporting a security issue

Please report vulnerabilities privately through the repository's GitHub
Security advisories rather than opening a public issue. Do not include secrets,
session data, or private downloads in a report.
