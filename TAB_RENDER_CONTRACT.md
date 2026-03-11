# Tab and Render Contract

This document defines the shared 3-panel render contract used across tabs.

## 1. Shared Structure

All supported tabs follow the same layout:
- left panel: items
- middle panel: main content
- right panel: config

Tabs:
- `playground`
- `dataset`
- `model`
- `training`

Reference shape for saved-entity tabs:

```js
{
  table: string,
  id: string
}
```

## 2. Tab Manager Contract

The core tab manager coordinates module selection and rendering.

Expected responsibilities:
- activate module for current tab
- initialize the shared `ITEM_PANEL_MODULE` for the left panel
- initialize the shared `CONFIG_PANEL_MODULE` for the right panel
- load item list from store
- pass items to item renderer
- handle active item callback
- load selected item data
- pass selected data to main renderer
- pass selected config contract to config renderer

## 3. Item Render Function Contract

Input:

```js
{
  items: Array<{
    id: string,
    title: string,
    meta?: string[],
    active?: boolean,
    capabilities?: {
      rename?: boolean,
      delete?: boolean
    }
  }>,
  allowNew: boolean,
  newLabel?: string,
  callbacks: {
    onActive?: function,
    onNew?: function,
    onRename?: function,
    onDelete?: function
  }
}
```

Behavior:
- render items in order
- highlight active item
- expose only allowed actions

Notes:
- For `playground`, items represent schema/module entries, not saved table records.
- For `dataset`, `model`, and `training`, items represent saved entities loaded from store.
- Item panel implementation must be shared across tabs. Differences come from input structure and callbacks, not tab-specific hardcode.

## 4. Main Render Function Contract

Input:

```js
{
  tab: string,
  moduleId: string,
  schemaId: string,
  itemId?: string,
  data?: object,
  contract?: object,
  callbacks?: object
}
```

Behavior:
- render main content for active item or active playground schema
- may use module override display
- if no override exists, use core default display

## 5. Config Render Function Contract

Input:

```js
{
  tab: string,
  moduleId: string,
  schemaId: string,
  itemId?: string,
  configContract: object,
  configData?: object,
  callbacks: {
    onChange?: function,
    onSave?: function,
    onRun?: function
  }
}
```

Behavior:
- render from contract/spec
- emit structured callback payloads
- must not fetch state directly

Notes:
- Config panel implementation must be shared across tabs.
- Right-panel config must be driven by `configContract` only.
- A module may provide a config schema override, but the render engine stays shared.

## 6. Callback Contract

Standard callback payload:

```js
{
  type: string,
  table: string,
  id?: string,
  schema?: string,
  config?: object
}
```

Supported callback types:
- `active`
- `new`
- `rename`
- `delete`
- `save`
- `run`

## 7. Tab-Specific Rules

### 7.1 Playground

- read-only
- no new
- no rename
- no delete
- active item is schema/module oriented, not saved entity management

### 7.2 Data Lab

- left panel manages saved datasets
- right panel manages dataset config
- middle panel shows overview/table/module display

### 7.3 Model Lab

- left panel manages saved models
- right panel manages node config or model config
- middle panel shows graph editor

### 7.4 Training Lab

- left panel manages trainer sessions
- right panel manages training config/runtime config
- middle panel shows selected trainer session details
