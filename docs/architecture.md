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

## Agent lifecycle

The engine observes the page before planning. It validates each proposed
action, requests permission when required, executes accepted actions, then
evaluates the result. If execution fails recoverably, the replanner can supply
a replacement action and the loop observes again. Event labels below are the
ones emitted by the engine; `PAGE_CHANGED` and `TASK_QUEUED` are schema event
types but are not currently emitted by this loop.

```mermaid
sequenceDiagram
    participant E as Engine
    participant B as Browser
    participant P as Planner
    participant V as Validator
    participant H as Host permission handler
    participant R as Replanner
    participant X as Event bus
    E->>X: TASK_STARTED
    loop While running and within task limits
        E->>B: Observe current page
        B-->>E: Page state
        E->>P: Plan from goal and observation
        P-->>E: TaskPlan
        E->>X: PLAN_CREATED
        loop For each proposed action
            E->>V: Validate action
            alt Invalid
                V-->>E: Rejected
                E->>X: ACTION_REJECTED
            else Valid
                V-->>E: Validated action
                E->>X: ACTION_PLANNED
                opt Permission required
                    E->>X: PERMISSION_REQUESTED
                    E->>H: Ask host for decision
                    alt Granted
                        H-->>E: Grant
                        E->>X: PERMISSION_GRANTED
                    else Denied or no handler
                        H-->>E: Deny
                        E->>X: PERMISSION_DENIED
                    end
                end
                E->>X: ACTION_STARTED
                E->>B: Execute action
                alt Succeeded
                    B-->>E: Result
                    E->>X: ACTION_COMPLETED
                    E->>E: Evaluate completion
                else Failed recoverably
                    B-->>E: Error
                    E->>X: ACTION_FAILED
                    E->>R: Replan after failure
                    R-->>E: Recovery action or no recovery
                end
            end
        end
    end
    E->>X: TASK_COMPLETED, TASK_FAILED, or TASK_CANCELLED
```

Extraction may emit `ITEM_FOUND`; download operations can emit
`DOWNLOAD_STARTED`, `DOWNLOAD_COMPLETED`, or `DOWNLOAD_FAILED`. Those event
types are defined in `packages/schemas/src/events.ts`.

When changing a contract, update the schema and run the integration tests.
Browser and extraction changes should include coverage under
`tests/integration`.
