# IR v1 Schemas

These schemas define the shared contracts used by web UI, server training, and notebook export.

Files:
- `dataset.spec.schema.json`
- `graph.spec.schema.json`
- `train.spec.schema.json`
- `eval.spec.schema.json`
- `training.session.spec.schema.json`
- `notebook.bundle.spec.schema.json`
- `runtime.handshake.spec.schema.json`
- `runtime.train_event.spec.schema.json`
- `examples/` (one valid example per schema)

## Contract Notes

- `irVersion` is locked to `"1.0"` where applicable.
- `graph.spec.schema.json` now validates the **real Drawflow payload** used in runtime (`drawflow.Home.data`), plus model-pack wrappers containing `graph`.
- `training.session` and `notebook.bundle` accept runtime ids used by the app (`js_client`, `server_tfjs`, `server_pytorch_gpu`, `server_pytorch_cpu`) and legacy ids for compatibility.
- `runtimeConfig` is optional in train/session/bundle specs and carries normalized runtime host/engine/backend/transport.
- `graphRef` and `graphRefs` are both allowed in session/bundle schemas for backward compatibility.
- Runtime adapters should emit the standardized event stream in `runtime.train_event.spec.schema.json`.
- Runtime-specific extensions belong in `metadata`.

## Schema-Registry Contract (Platform Runtime)

IR v1 JSON schemas above are export/runtime specs.
For adding new dataset types into the web platform, use the schema-registry/module contracts:

1. `schema_registry` contract (registerSchema payload)
- dataset side:
  - `sampleType` (`trajectory`, `image`, ...)
  - split defaults/modes
  - display metadata
- model side:
  - allowed outputs
  - optional preset list
  - `featureNodes` metadata
  - `featureNodes.policy` (what feature nodes are allowed by this schema)

2. Image schema minimum metadata
- `featureNodes.imageSource[]` with:
  - `key`
  - `shape` (for image use `[height, width, channels]`)
  - `featureSize` (flatten size)
- `featureNodes.oneHot[]` for labels (if classification)

3. `ImageSource` node behavior
- must read source options from schema metadata
- should not hardcode width/height/channels
- downstream graph decides flatten/conv usage

Templates:
- `examples/schema_registry.image_classification.template.json`
- `examples/dataset_module.image.contract.template.json`

Validation example (Python):

```python
import json
from jsonschema import validate

schema = json.load(open('schemas/graph.spec.schema.json'))
spec = json.load(open('models/direct_mlp_strong.model.json'))
validate(instance=spec, schema=schema)
```
