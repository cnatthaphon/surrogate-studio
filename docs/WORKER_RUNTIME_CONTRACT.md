# Worker and Runtime Contract

This document defines the contract between core orchestration, worker execution, and runtime backends.

## 1. Core Rule

- Main thread handles rendering and orchestration.
- Worker or runtime handles compute-heavy execution.
- Runtime differences must not change the upper-layer contract.

## 2. Worker Execute Contract

```js
execute({
  action,
  payload
})
```

Input:

```js
{
  action: string,
  payload: object
}
```

Output:

```js
{
  ok: boolean,
  action: string,
  data?: object,
  error?: string
}
```

Lifecycle support:

```js
create({ trainerId, onMessage })
remove({ trainerId })
postMessage({ trainerId, action, payload })
on_message(event)
```

## 3. Supported Action Families

### 3.1 Dataset Actions

- `dataset_init`
- `dataset_prepare`
- `dataset_generate`
- `dataset_fetch`

Payload examples:

```js
{
  moduleId: string,
  schemaId: string,
  config: object
}
```

### 3.2 Training Actions

- `train_init`
- `train_run`
- `train_resume`
- `train_stop`

Payload examples:

```js
{
  trainerId: string,
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

### 3.3 Evaluation Actions

- `eval_run`
- `sample_run`

## 4. Progress Event Contract

Workers and runtimes must emit a standard progress event shape:

```js
{
  type: string,
  trainerId?: string,
  sessionId?: string,
  epoch?: number,
  step?: number,
  totalEpochs?: number,
  metrics?: object,
  status?: string,
  history?: {
    train?: Array<object>,
    val?: Array<object>
  }
}
```

Examples:
- `train_started`
- `epoch_end`
- `validation_end`
- `train_finished`
- `train_failed`

## 5. Runtime Train Request Contract

```js
{
  trainerId: string,
  schemaId: string,
  dataset: object,
  modelGraph: object,
  modelConfig?: object,
  runtimeConfig: {
    runtimeFamily: "tfjs" | "pytorch",
    runtimeBackend: string,
    runtimeHost?: "client" | "server",
    endpoint?: string
  },
  trainConfig: object,
  initialWeights?: object,
  schedulerState?: object
}
```

## 6. Runtime Train Result Contract

```js
{
  ok: boolean,
  trainerId: string,
  metrics?: object,
  history?: {
    train?: Array<object>,
    val?: Array<object>
  },
  updatedWeights?: object,
  updatedScheduler?: object,
  updatedConfig?: object,
  error?: string
}
```

## 7. Runtime Test Result Contract

```js
{
  ok: boolean,
  trainerId: string,
  metrics?: object,
  predictions?: object,
  error?: string
}
```

## 8. Notes

- Dataset modules do not own worker implementations.
- Runtime modules may use worker, subprocess, or remote endpoint internally.
- Current intended split:
  - `tfjs` family -> browser/client worker runtime, with optional `tf-node` / `server_tfjs` adapter on server for same-family continuation
  - `pytorch` family -> nodejs runtime manager -> python subprocess runtime baseline
- Upper layers must receive the same result shape regardless of backend.
