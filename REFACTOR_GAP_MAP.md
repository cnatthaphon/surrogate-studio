# Refactor Gap Map

This document maps the current codebase against the architecture and contract documents.
It is intended to guide refactor work in a controlled order.

## Status Labels

- `aligned`: implementation direction matches architecture closely
- `partial`: implementation exists but still leaks legacy behavior or mixed responsibilities
- `misaligned`: implementation conflicts with target architecture and should be changed before expansion

## 1. Storage Adapter Layer

Status: `partial`

Primary files:
- `src/workspace_store.js`
- `src/app.js`

What is aligned:
- adapter concept exists
- IndexedDB store exists
- memory path exists
- `peekRaw()` / `snapshot()` support exists
- entity persistence is already centralized in `workspace_store.js`

What is still misaligned:
- entity-specific methods still dominate API shape:
  - `upsertDataset`
  - `upsertModel`
  - `upsertTrainerCard`
  - `appendTrainerEpoch`
- generic `table` contract is not yet the only public path
- `app.js` still calls store in a way coupled to current entity structures

Evidence:
- `src/workspace_store.js:408`
- `src/workspace_store.js:432`
- `src/workspace_store.js:456`
- `src/workspace_store.js:484`
- `src/workspace_store.js:521`

Refactor target:
- normalize store usage around `save/load/list/remove/query({ table, ... })`
- keep entity wrappers only as thin compatibility adapters or remove them later

## 2. Worker / Compute Execution Layer

Status: `partial`

Primary files:
- `src/dataset_service_core.js`
- `src/dataset_worker.js`
- `src/training_worker.js`
- `src/training_worker_bridge.js`
- `src/training_session_core.js`
- `src/app.js`

What is aligned:
- dedicated dataset worker exists
- dedicated training worker exists
- worker bridge exists
- training session core already builds worker-facing specs
- compute work is not fully on main thread anymore

What is still misaligned:
- worker usage is still orchestrated directly from `app.js`
- dataset/training worker contracts are not yet unified behind one clear execution service layer
- fallback/error paths in `app.js` still mix orchestration with execution policy

Evidence:
- `src/app.js:4580`
- `src/app.js:4655`
- `src/app.js:14704`
- `src/app.js:14914`
- `src/dataset_service_core.js:22`
- `src/training_session_core.js:26`

Refactor target:
- keep worker logic in core services
- reduce `app.js` to calling normalized execution APIs only
- align progress/result payloads with `WORKER_RUNTIME_CONTRACT.md`

## 3. Runtime Layer

Status: `partial`

Primary files:
- `src/app.js`
- `src/training_worker.js`

What is aligned:
- runtime profiles exist
- backend normalization exists
- runtime handshake exists
- browser training worker negotiates backend

What is still misaligned:
- runtime normalization and handshake still live mainly in `app.js`
- runtime request/result contract is not yet isolated in a dedicated runtime core module
- client/server parity is scaffolded, but not complete
- runtime family split is not enforced sharply enough in code:
  - `tfjs` should use browser/client as baseline and treat `tf-node` / `server_tfjs` as an optional same-family adapter
  - `pytorch` should remain the server/notebook baseline family
- nodejs runtime-manager -> python subprocess path is still more implicit than contractual

Evidence:
- `src/app.js:10388`
- `src/app.js:10540`
- `src/app.js:10629`
- `src/training_worker.js:292`
- `src/training_worker.js:329`

Refactor target:
- isolate runtime contract and handshake logic from `app.js`
- standardize request/result/progress shape for all runtimes
- make runtime family an explicit first-class field in trainer/runtime contracts

## 4. Schema Layer

Status: `aligned`

Primary files:
- `src/schema_registry.js`
- `src/schema_definitions_builtin.js`

What is aligned:
- schema registry is separate
- built-in schema definitions are separate
- presets are declarative
- palette is declarative
- feature node metadata is schema-driven

Evidence:
- `src/schema_registry.js`
- `src/schema_definitions_builtin.js`

Notes:
- this is one of the strongest-aligned layers in the current codebase

## 5. Dataset Module Layer

Status: `partial`

Primary files:
- `src/app.js`
- `src/dataset_modules/*`

What is aligned:
- module registry concept exists
- multiple modules exist:
  - oscillator
  - mnist
  - fashion_mnist
- module help/preconfig/schema lookup already exists

What is still misaligned:
- `app.js` still owns too much dataset UI orchestration
- dataset module render/generate contracts are not isolated enough from UI flow
- `applyDatasetModuleUi(...)` still couples module behavior to page structure

Evidence:
- `src/app.js:201`
- `src/app.js:331`
- `src/app.js:7959`
- `src/app.js:8049`

Refactor target:
- move dataset behavior behind explicit dataset module contracts
- keep dataset-specific display overrides callable from shared render layer

## 6. Model Module / Graph Layer

Status: `partial` leaning `aligned`

Primary files:
- `src/model_graph_core.js`
- `src/graph_ui_core.js`
- `src/app.js`

What is aligned:
- model graph core exists
- graph UI core exists
- config spec/application moved out of `app.js`
- node palette is schema-driven

What is still misaligned:
- `app.js` still wires many model-lab flows directly
- model-lab startup/render behavior is still fragile in browser flow
- some orchestration remains mixed with UI state management
- persisted model shape is not consistently treated as `graph + per-node config` at all boundaries

Evidence:
- `src/model_graph_core.js:507`
- `src/model_graph_core.js:735`
- `src/app.js:5629`
- `src/app.js:8296`
- `src/app.js:14361`

Refactor target:
- continue reducing `app.js` to orchestration only
- keep graph build/config logic inside model graph core

## 7. Tab Manager / Render Layer

Status: `partial`

Primary files:
- `src/app.js`
- `src/ui_shared_engine.js`

What is aligned:
- left-panel item rendering is shared
- selection-state helper exists
- 3-panel idea is implemented in structure
- multiple labs use the same high-level layout
- item/config render engine idea is already present in fragments

What is still misaligned:
- actual tab orchestration still lives mostly inside one large `app.js`
- `showWorkspaceTab(...)` still mixes activation, rendering, and side effects
- Data/Playground/Training still leak state into each other in some paths
- item-panel and config-panel modules are not yet formalized as explicit core modules

Evidence:
- `src/app.js:6798`
- `src/app.js:8250`
- `src/app.js:8380`
- `src/app.js:11222`

Refactor target:
- formalize tab-manager core
- keep `items/main/config` render calls consistent across labs
- eliminate cross-tab state coupling

## 8. Notebook Export Layer

Status: `partial`

Primary files:
- `src/notebook_bundle_core.js`
- `src/notebook_runtime_assets.js`
- `src/app.js`

What is aligned:
- notebook export core exists
- runtime assets exist
- export path is tied to app data/model/session state

What is still misaligned:
- legacy oscillator naming still remains in notebook payload assets
- export packaging rules are not yet fully aligned with the new portable platform naming/story
- browser export flow has recently been unstable in UI paths

Evidence:
- `src/notebook_runtime_assets.js`
- `src/app.js`

Refactor target:
- keep export contract session-driven and portable
- reduce project-specific assumptions in exported asset naming over time

## 9. Browser Flow Stability

Status: `misaligned`

Primary files:
- `src/app.js`

Why this remains blocker:
- browser flow still prevents reliable verification of higher-layer architecture work
- Data Lab switching lag and Model Lab creation/render regressions still interrupt contract validation

Refactor target:
- stabilize browser flow before broadening feature scope
- keep main-thread work limited to activation/render
- keep worker/runtime/session work out of tab-switch and startup paths
- `index.html`

Known issues:
- startup freeze
- tab switching instability
- Data Lab / Playground interference
- Model palette disappearing in browser despite schema definitions existing

This is currently the top blocker for feature expansion.

Refactor target:
- stabilize browser flow before further architectural expansion

## 10. Recommended Refactor Order

1. stabilize browser flow and tab state isolation
2. normalize store usage around generic `table` contract
3. isolate worker/runtime execution services from `app.js`
4. formalize dataset module contract boundaries
5. continue shrinking `app.js` into tab manager + render orchestration only
6. harden notebook export against platform-wide contracts
