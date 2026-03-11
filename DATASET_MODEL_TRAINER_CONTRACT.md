# Dataset, Model, and Trainer Module Contract

This document defines the expected contracts for dataset, model, and trainer modules.

## 1. Dataset Module Contract

Purpose:
- implement dataset-specific behavior

Required functions:

```js
init(context)
generate(config)
get(index, context)
```

Optional functions:

```js
renderPlayground(data, config, context)
renderDataset(data, config, context)
```

### 1.1 `init`

Input:

```js
{
  schemaId: string,
  moduleId: string,
  runtime?: object
}
```

Output:

```js
{
  ok: boolean,
  state?: object,
  error?: string
}
```

### 1.2 `generate`

Input:

```js
{
  schemaId: string,
  moduleId: string,
  config: object
}
```

Output:

```js
{
  ok: boolean,
  dataset?: object,
  error?: string
}
```

### 1.3 `get`

Input:

```js
{
  index: number,
  datasetRef?: object,
  context?: object
}
```

Output:

```js
{
  ok: boolean,
  sample?: object,
  error?: string
}
```

Rules:
- Dataset module may fetch or prepare data if needed.
- Heavy compute must still run via core worker/runtime execution path.

## 2. Model Module Contract

Purpose:
- implement model graph behavior around schema contracts

Required responsibilities:
- validate graph
- build graph representation
- convert graph to runtime-specific model form

Recommended functions:

```js
validate(graph, schema)
build(graph, schema)
export_graph(graph)
import_graph(payload)
```

Canonical model payload:

```js
{
  id: string,
  schemaId: string,
  graph: object,
  config: {
    [nodeId]: object
  }
}
```

Output example:

```js
{
  ok: boolean,
  graph?: object,
  warnings?: string[],
  error?: string
}
```

Rules:
- model is schema-bound
- preset graphs come from schema
- node config rules must follow graph/model contract
- graph structure and per-node config must be stored separately
- graph-to-runtime conversion maps graph/config into family-specific code paths such as `tfjs` or `pytorch`

## 3. Trainer Module Contract

Purpose:
- bind dataset + model + runtime into a trainable session

Required fields:
- `trainerId`
- `schemaId`
- `datasetRef`
- `modelRef`
- `runtimeConfig`
- `trainConfig`
- `sessionId`

Recommended functions:

```js
create(config)
update(config)
run(config)
stop(config)
export_notebook(config)
```

### 3.1 Trainer Create Input

```js
{
  trainerId: string,
  sessionId?: string,
  schemaId: string,
  datasetRef?: { table: "datasets", id: string },
  modelRef?: { table: "models", id: string },
  runtimeConfig?: {
    runtimeFamily: "tfjs" | "pytorch",
    runtimeBackend: string,
    runtimeHost?: "client" | "server",
    endpoint?: string
  },
  trainConfig?: object
}
```

### 3.2 Trainer Run Input

```js
{
  trainerId: string,
  sessionId?: string,
  schemaId: string,
  datasetRef: { table: "datasets", id: string },
  modelRef: { table: "models", id: string },
  runtimeConfig: {
    runtimeFamily: "tfjs" | "pytorch",
    runtimeBackend: string,
    runtimeHost?: "client" | "server",
    endpoint?: string
  },
  trainConfig: object
}
```

### 3.3 Trainer Result

```js
{
  ok: boolean,
  trainerId: string,
  status?: string,
  history?: {
    train?: Array<object>,
    val?: Array<object>
  },
  metrics?: object,
  error?: string
}
```

Rules:
- trainer schema is fixed after creation
- dataset and model may change only within the same schema
- trainer progress must be streamed via runtime/worker progress contract
- trainer owns its runtime session/worker lifecycle
- first `run/train/test` may lazily create session
- deleting trainer must clear/dispose its session
- notebook export is baseline only for the `pytorch` runtime family

## 4. Shared Notes

- These module contracts must be callable directly from scripts without UI.
- UI should only pass data through these contracts and render results.
- No extra behavior should exist only in test scripts.
