# Store Contract

This document defines the storage contract used by upper modules. Storage backend may be `memory`, `localStorage`, `IndexedDB`, `server DB`, or `server files`, but the contract must remain the same.

## 1. Scope

Logical tables:
- `datasets`
- `models`
- `trainers`
- `sessions`
- `meta`

## 2. Required Methods

```js
save({ table, id, data })
load({ table, id })
list({ table, query })
remove({ table, id })
query({ table, where, orderBy, limit, offset })
```

## 3. Method Contracts

### 3.1 `save`

Input:

```js
{
  table: string,
  id: string,
  data: object
}
```

Output:

```js
{
  ok: boolean,
  table: string,
  id: string,
  updatedAt: number,
  error?: string
}
```

Behavior:
- create if record does not exist
- replace or upsert if record exists
- must not mutate caller-owned input object

### 3.2 `load`

Input:

```js
{
  table: string,
  id: string
}
```

Output:

```js
{
  ok: boolean,
  table: string,
  id: string,
  data: object | null,
  error?: string
}
```

### 3.3 `list`

Input:

```js
{
  table: string,
  query?: object
}
```

Output:

```js
{
  ok: boolean,
  table: string,
  items: Array<{
    id: string,
    data: object,
    createdAt?: number,
    updatedAt?: number
  }>,
  error?: string
}
```

Behavior:
- intended for simple table listing
- may support lightweight filtering via `query`

### 3.4 `remove`

Input:

```js
{
  table: string,
  id: string
}
```

Output:

```js
{
  ok: boolean,
  table: string,
  id: string,
  removed: boolean,
  error?: string
}
```

### 3.5 `query`

Input:

```js
{
  table: string,
  where?: object,
  orderBy?: {
    field: string,
    direction: "asc" | "desc"
  },
  limit?: number,
  offset?: number
}
```

Output:

```js
{
  ok: boolean,
  table: string,
  items: Array<{
    id: string,
    data: object,
    createdAt?: number,
    updatedAt?: number
  }>,
  total?: number,
  error?: string
}
```

## 4. Error Contract

All methods must return a consistent error shape:

```js
{
  ok: false,
  error: string
}
```

Rules:
- do not throw for expected storage errors when a structured result can be returned
- reserve thrown exceptions for fatal adapter initialization failures

## 5. Notes

- Upper layers must not know which backend is active.
- Store layer is persistence only. It must not own business logic for datasets, models, or trainers.

