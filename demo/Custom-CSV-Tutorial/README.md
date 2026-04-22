# Custom CSV Tutorial — Bring Your Own Dataset

This demo shows how to use Surrogate Studio with your own tabular data. It ships with a built-in Iris-like sample dataset so you can try everything immediately, then swap in your own CSV.

## How It Works

Surrogate Studio is **schema-driven**: the schema defines what your data looks like (features, targets, task type), and the platform handles model building, training, and evaluation automatically.

For custom data you need:
1. **A CSV file** with columns: `split, f0, f1, ..., t0, t1, ...`
2. **A schema** that tells the platform: feature count, target count, task type (classification or regression)
3. **A model** — build visually in the graph editor, or use a preset

The platform auto-detects classification vs regression from the target values.

## CSV Format

```csv
split,f0,f1,f2,f3,t0
train,5.1,3.5,1.4,0.2,0
train,4.9,3.0,1.4,0.2,0
val,7.0,3.2,4.7,1.4,1
test,6.3,3.3,6.0,2.5,2
```

| Column | Description |
|--------|-------------|
| `split` | Which split: `train`, `val`, or `test` |
| `f0, f1, ...` | Feature columns (any number) |
| `t0, t1, ...` | Target columns (1 for classification label, N for regression) |

## Built-in Sample: Iris Dataset

150 samples, 4 features (sepal/petal length and width), 3 classes. Split: 105 train / 23 val / 22 test.

| Class | Name |
|-------|------|
| 0 | Setosa |
| 1 | Versicolor |
| 2 | Virginica |

## Models

### 1. MLP Classifier (with regularization)
```
Input(4) → Dense(32,relu) → BatchNorm → Dense(16,relu) → Dropout(0.2) → Output(label)
```

### 2. Simple MLP (baseline)
```
Input(4) → Dense(16,relu) → Output(label)
```

## How to Use

### Quick start (built-in data)
1. **Dataset** tab → click Generate Dataset (uses Iris sample, instant)
2. **Model** tab → inspect or modify the MLP graph
3. **Trainer** tab → click Start Training (trains in browser, ~10 seconds)
4. **Evaluation** tab → compare MLP vs Simple baseline

### With your own CSV
1. **Playground** tab → click "Choose File" to upload your CSV
2. **Dataset** tab → click Generate Dataset (reads your CSV)
3. **Model** tab → adjust the Input node's `featureSize` to match your column count
4. **Trainer** tab → train on client (TF.js) or check "Use PyTorch Server" for server training

### With server local path
```bash
npm start   # start the server at localhost:3777
```
In the **Dataset** tab, expand "Local Source (Server Training)" and fill in:

| Field | Description |
|-------|-------------|
| **Use local source** | Check to enable |
| **Source type** | `Local CSV + manifest` or `Local JSON dataset` |
| **Dataset path** | Absolute path to your CSV, e.g. `/data/iris.csv` |
| **Manifest path** | Path to a JSON manifest with `schemaId`, `mode`, `classCount` |
| **Feature columns** | Number of `f*` columns in the CSV |
| **Target columns** | Number of `t*` columns |
| **Classes** | Number of classes (0 for regression) |

Example manifest (`manifest.json`):
```json
{
  "schemaId": "custom_csv",
  "mode": "classification",
  "classCount": 3
}
```

The server reads the files directly via `dataset_source_loader.py` — no upload needed.

Sample files included in this demo folder for testing:
- [`sample_iris.csv`](sample_iris.csv) — 42 samples, 4 features, 3 classes
- [`sample_manifest.json`](sample_manifest.json) — manifest with schemaId, classCount, classNames

## Defining Your Own Schema

To add a fully custom schema (not just a CSV), create a schema definition with:

```javascript
registerSchema({
  id: "my_custom_task",
  label: "My Custom Task",
  taskRecipeId: "supervised_standard",  // or "segmentation_mask", "detection_single_box", etc.
  dataset: {
    sampleType: "tabular",              // or "image", "sequence", "trajectory"
    splitDefaults: { mode: "random", train: 0.70, val: 0.15, test: 0.15 },
  },
  model: {
    outputs: [
      { key: "target", headType: "regression" },    // or "classification"
    ],
    metadata: {
      featureNodes: {
        palette: { items: [...] },      // which node types to show in the editor
      },
    },
  },
});
```

See `src/schema_definitions_builtin.js` for 12 real-world examples.

## References

- Fisher, R.A. **"The Use of Multiple Measurements in Taxonomic Problems."** *Annals of Eugenics*, 1936. — The classic Iris dataset used as the built-in sample.

This demo serves as a starting point for integrating any tabular dataset into Surrogate Studio's visual ML pipeline.
