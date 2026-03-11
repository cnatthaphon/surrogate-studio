# Platform Architecture Spec v0.1

This document defines the intended platform architecture in a bottom-up way.
It is the baseline for future refactor work. The goal is to make the system modular, contract-driven, and portable across browser, server, and notebook export flows.

## 1. Core Principles

1. `schema` defines structure, not behavior.
2. `module` implements behavior behind a schema or runtime contract.
3. `main thread` is responsible for orchestration and rendering only.
4. `worker/runtime` is responsible for compute-heavy execution.
5. `store` is an adapter layer. Backend changes must not change upper-layer contracts.
6. `render` is driven by contracts and parameters, not schema-specific hardcode.
7. Every layer must be testable independently through function/module contracts.

## 2. Layered Architecture

### 2.1 Storage Adapter Layer

Purpose:
- Persist, load, query, and delete platform entities.

Backends:
- `memory`
- `localStorage`
- `IndexedDB`
- `server DB`
- `server files`

Requirement:
- All backends must expose the same contract.

Recommended contract shape:

```js
save({ table, id, data })
load({ table, id })
list({ table, query })
remove({ table, id })
query({ table, where, orderBy, limit, offset })
```

Notes:
- `table` means logical collection such as `datasets`, `models`, `trainers`, `sessions`.
- Storage internals can differ, but input/output contract must stay the same.

### 2.2 Worker / Compute Execution Layer

Purpose:
- Run expensive work off the main thread.

Responsibilities:
- dataset generation
- dataset preparation / fetch / decode
- training
- evaluation
- sampling

Requirement:
- Workers must be generic core services.
- Dataset modules must not own worker implementations.

Recommended contract shape:

```js
execute({
  action,
  payload
})
```

Response:

```js
{
  ok,
  data,
  error
}
```

Progress callback/event:

```js
{
  type,
  sessionId,
  epoch,
  step,
  metrics
}
```

### 2.3 Runtime Layer

Purpose:
- Abstract where model execution happens.

Examples:
- browser tfjs cpu
- browser tfjs webgl
- browser tfjs wasm
- browser tfjs webgpu
- nodejs runtime manager
- python/pytorch subprocess runtime
- remote server runtime

Requirement:
- Runtime differences are hidden behind one shared contract.

Runtime responsibilities:
- prepare dataset for runtime
- build model from graph
- train
- validate
- test
- sample
- return progress/results in a standard format

Runtime family rule:
- `tfjs` family uses browser/client as its baseline runtime and may optionally expose a `tf-node` / `server_tfjs` adapter for same-family continuation on server.
- `pytorch` family is the server/notebook baseline runtime family.
- Cross-family graph/config portability is required.
- Cross-family weight continuation is not baseline behavior.

## 3. Schema Layer

### 3.1 Dataset Schema

Purpose:
- Declarative description of dataset structure and policy.

Must define:
- `id`
- `label`
- `fields`
- `sample type`
- `split defaults`
- `display policy`
- `playground config contract`
- built-in `model presets` suitable for this dataset, or an explicit empty list

Examples of schema-driven concerns:
- image vs trajectory
- available labels
- available feature fields
- stratify options
- default display mode

Rule:
- Dataset schema must not embed execution logic.

### 3.2 Model Schema / Graph Contract

Purpose:
- Declarative description of model graph structure and node configuration contract.

Must define:
- graph structure format
- node types
- node config schema
- feature/output compatibility with dataset schema
- preset graph definitions

Rule:
- Presets should be plain structured data, not hardcoded branching logic in core.

## 4. Module Layer

### 4.1 Dataset Module

Purpose:
- Implement dataset-specific behavior.

Expected responsibilities:
- `init()`
- `generate(config)`
- `get(idx)`
- `renderPlayground(data, config)` or display override
- `renderDataset(data, config)` or display override

Notes:
- If no override is provided, core display should be used.
- Fetching and preparation logic belongs here, but execution should still run via worker/core execution layer.
- Dataset modules must not own worker implementations. Core execution services call module functions through shared contracts.

### 4.2 Model Module

Purpose:
- Implement model graph behavior around schema contracts.

Expected responsibilities:
- graph validation
- node registry / node factory mapping
- graph-to-runtime conversion
- graph import/export

Canonical persisted model shape:

```js
{
  id: string,
  schemaId: string,
  graph: {
    nodes: object,
    links: object
  },
  config: {
    [nodeId]: object
  }
}
```

Notes:
- `graph` holds structural connectivity.
- `config` holds per-node parameters separately.
- core connects config panels with dataset/model schema constraints for feature and output nodes.

### 4.3 Trainer Module

Purpose:
- Manage model + dataset + runtime binding for training.

Expected responsibilities:
- trainer session config
- runtime selection
- backend selection
- training state
- progress/result collection
- session lifecycle ownership

Trainer session rule:
- A trainer session owns its worker/runtime session.
- Worker/runtime session is created lazily on first train/test/run action.
- Worker/runtime session stays alive until trainer deletion, explicit clear, or page reload.

### 4.4 Notebook Export Module

Purpose:
- Export a portable package for offline or remote execution.

Package target:
- notebook
- dataset payload
- model graph payload

Requirement:
- Export must come from the same core contracts used by the app.
- Export must not depend on hidden local files outside the package.
- Export package must be runnable from any location using only packaged files plus standard user-installed dependencies.
- References may exist inside the app, but export output must resolve them into portable payloads.

## 5. Core Orchestrator Layer

### 5.1 Tab Manager (Core)

Purpose:
- Coordinate each lab/tab using the same high-level flow.

Responsibilities:
- activate module for current tab
- create/init shared item-panel module for left panel
- create/init shared config-panel module for right panel
- load item list from store
- pass item data to item renderer
- handle active item change
- query full data from store
- pass selected data to main renderer
- pass config contract/data to config renderer
- dispatch user actions back to module/store/runtime

Rule:
- Tab manager must not contain schema-specific hardcode.
- Tab manager orchestrates shared panel modules; it must not implement tab-specific rendering logic inline.

### 5.2 Shared Contracts for Tab Manager

Common callback types:
- `active`
- `new`
- `rename`
- `delete`
- `save`
- `run`

Common payload shape:

```js
{
  type,
  table,
  id,
  schema,
  config
}
```

## 6. Render Layer

The platform uses the same 3-panel pattern across labs.

### 6.1 Items Render Function

Purpose:
- Render left panel items.

Expected input:
- list of items
- per-item capabilities
- callbacks

Capabilities:
- active
- rename
- delete
- optional create button

### 6.2 Main Render Function

Purpose:
- Render the main content for the active item or active playground selection.

Examples:
- dataset overview
- dataset table
- playground visualization
- model graph editor
- training session details

### 6.3 Config Render Function

Purpose:
- Render right-panel configuration cards.

Rule:
- Config UI must come from a contract/spec, not hardcoded per tab when the structure is shared.
- Render functions receive `contract + data + callbacks` and must not fetch or mutate business state directly.

## 7. Labs / Tabs

### 7.1 Playground

Purpose:
- inspect and demonstrate registered dataset schemas/modules

Rules:
- read-only
- no create
- no rename
- no delete

### 7.2 Data Lab

Purpose:
- create and manage datasets

Rules:
- left: saved dataset items
- middle: selected dataset overview/table/main display
- right: dataset config for selected schema/module

### 7.3 Model Lab

Purpose:
- create and manage models bound to a dataset schema

Rules:
- model is schema-bound
- presets come from schema
- node palette/config derives from schema + graph contracts

### 7.4 Training Lab

Purpose:
- create and manage training sessions

Rules:
- trainer is schema-bound
- trainer schema is fixed after creation
- trainer selects compatible dataset/model within the same schema
- runtime/backend are runtime-layer concerns
- progress must be streamed back in a standard format

## 8. Testing Strategy

### 8.1 Unit / Contract Tests

Each layer must be testable by direct function calls without UI:
- schema registry
- dataset modules
- model graph core
- graph ui core
- store module
- worker bridge
- trainer core
- export core

### 8.2 Integration / Browser Tests

UI tests come after module contracts are stable.

Focus:
- tab switching
- active item propagation
- render consistency
- startup restore
- no main-thread freeze for compute paths

## 9. Non-Negotiable Constraints

1. No schema-specific hardcode in core orchestration/render paths.
2. No hidden fallback that masks architectural errors.
3. No business logic hidden inside UI-only render functions.
4. No worker logic embedded directly inside dataset-specific UI code.
5. No backend-specific store logic leaking into upper modules.

## 10. Immediate Refactor Target

The current refactor should move the codebase toward this final shape:

1. stabilize browser flow first
2. fix tab/core/render separation
3. normalize store contract around generic `table` operations
4. normalize worker/runtime contracts for dataset, train, test, and progress
5. keep `schema` declarative
6. keep `module` behavior isolated
7. keep `app/core tab manager` orchestration-only
8. keep `render layer` contract-driven
