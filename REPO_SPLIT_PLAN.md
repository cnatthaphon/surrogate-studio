# Repository Split Plan (In-Place -> New Repo)

Date: 2026-03-06

## Decision
- Keep development in-place inside `comphys/oscillator-surrogate` for now.
- Split to a new repo (`surrogate-platform`) before release/public write-up.

This avoids breaking active development while preparing a clean release boundary.

## Why this path
- Current app is still moving quickly (Data/Model/Training UX and runtime adapters).
- In-place keeps IndexedDB/dev flow stable during feature completion.
- Pre-release split gives a clean history and easier portfolio narrative.

## Target split

### New repo: `surrogate-platform`
- `core/`
  - schema registry
  - dataset runtime
  - dataset processing core
  - workspace store
  - shared UI engine
  - notebook bundle core + runtime assets
  - workers
- `modules/`
  - oscillator
  - mnist
  - fashion_mnist
  - module registry
- `apps/web-lab/`
  - current browser app shell (`index.html`, `src/app.js`)
- `scripts/`
  - contract tests + headless pipeline tests
- `docs/`
  - architecture/roadmap/release notes

### Existing repo: `comphys`
- keep domain-specific experiments/apps
- consume platform core as dependency/submodule or copied release package

## Hard gates before split
1. Core contract tests pass:
   - `node scripts/test_contract_all.js`
2. Headless flow pass (function-driven, no manual edits in test path):
   - create dataset -> create model -> create trainer -> export zip
3. Notebook export contract is stable:
   - zip contains only required portable artifacts
4. UI freeze issue resolved on dataset switch / train worker flow

## Execution steps (pre-release week)
1. Run staging script:
   - `bash scripts/stage_platform_repo.sh`
2. Create new repo and copy from staging directory.
3. Run tests again in new repo.
4. Add CI for contract tests.
5. Tag old location in `comphys` and add pointer README.

## Notes
- No migration/fallback policy for core contracts.
- No hidden local-file dependency in notebook export path.
- Same runtime event shape across client/server/notebook.
