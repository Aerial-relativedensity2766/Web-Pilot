# Architecture

Web-Pilot is organized as a Turborepo. The applications use shared packages
for task state, browser control, extraction, downloads, and schemas.

```mermaid
flowchart LR
    UI[Web app] --> API[API app]
    API --> AG[agent-core]
    AG --> BC[browser-core]
    AG --> EX[extraction-core]
    EX --> SH[shared]
    API --> SC[schemas]
    API --> DL[download-core]
```

`schemas` defines state and event contracts. `agent-core` validates and
replans work, `browser-core` owns browser actions, and `extraction-core` turns
observed pages into structured content. `download-core` handles manifests,
naming, deduplication, and verification. Cross-cutting helpers live in
`shared`.

When changing a contract, update the schema and run the integration tests.
Browser and extraction changes should include coverage under
`tests/integration`.
