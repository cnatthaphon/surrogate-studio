# Screenshot Capture Guide — TrAISformer Demo

Capture these screenshots/GIFs for the README. Use any screen recorder (ScreenToGif, ShareX, OBS).

## 1. `images/map_trajectories.gif` — Hero GIF
1. Open `demo/TrAISformer/index.html` in Chrome
2. Go to Dataset tab, click "Generate Dataset"
3. Wait for Leaflet map to load with satellite tiles
4. Record: pan around the Baltic Sea, click a trajectory point (popup shows coordinates), toggle train/val/test checkboxes, zoom in/out
5. Duration: ~8-12 seconds

## 2. `images/model_graph.gif` — Model Graph
1. Go to Model tab
2. Select "2. Tiny TrAISformer (1 block)" from left panel
3. Record: show the graph with WindowHistory -> Input -> Reshape -> Dense -> TransformerBlock -> GlobalAvgPool1D -> Dense -> Output
4. Click nodes to show config in right panel (units, heads, ffnDim)
5. Switch to "1. MLP Baseline" to show contrast
6. Duration: ~6-8 seconds

## 3. `images/evaluation_benchmark.gif` — Evaluation Results
1. Go to Evaluation tab
2. Select the "Trajectory Prediction Benchmark" evaluation
3. Click "Run Evaluation" (needs dataset generated first)
4. Record: loading spinner, progress updates, then final table + bar chart
5. Show the green-highlighted best values in the comparison table
6. Duration: ~8-10 seconds

## 4. `images/dataset_explorer.gif` — Dataset Tab
1. Go to Dataset tab with data generated
2. Record: the split counts, map interaction, color bar for speed
3. Click a few trajectory points to show popup tables
4. Toggle between train/val/test
5. Duration: ~6-8 seconds

## 5. `images/demo_workflow.gif` — Full Workflow (optional)
1. Quick tour: Dataset -> Model -> Trainer (show pretrained metrics) -> Evaluation
2. Duration: ~15-20 seconds

## Tips
- Browser window: 1280x800 or similar
- Dark theme is already built-in
- Optimize GIFs to <2MB each (use gifsicle or ScreenToGif compression)
- PNG screenshots are also fine for static views
