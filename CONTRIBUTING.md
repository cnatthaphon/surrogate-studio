# Contributing

This repository uses a single-source-of-truth workflow:

- `main` is the only source of truth.
- Do not develop directly on `main`.
- Create one short-lived branch per issue from the latest `main`.
- Merge back to `main` only after review and checks.
- Delete the branch after merge.

## Branch Workflow

Recommended branch naming:

- `codex/<topic>`
- `claude/<topic>`
- `<your-name>/<topic>`

Expected merge flow:

1. `git checkout main`
2. `git pull`
3. `git checkout -b <branch-name>`
4. Make the change
5. Run the relevant checks
6. Review the diff
7. Merge to `main`
8. Push `main`
9. Delete the branch

## Agent Workflow

If multiple coding agents are being used:

- give each agent its own branch
- avoid sharing one writable checkout between active agents
- merge agent branches into `main` intentionally, not by drift

This file is the project-level workflow source of truth. If a tool-specific file is added later, it should point back here instead of redefining different rules.

## Runtime Notes

- If a change touches `server/*.py` or `server/training_server.js`, restart the training server before testing.
- If a change touches browser UI/runtime files in `src/`, reload the page before judging behavior.
- For stateful actions like train, stop, import, export, and generate, prefer explicit blocking/disabled UI states over optimistic re-click behavior.

## Validation

Run the smallest relevant set before merge.

Common checks:

```bash
npm test
npm run test:browser
npm run test:pipeline
node scripts/test_headless_notebook_export.js
node scripts/test_headless_export_verify.js
```

When server/runtime behavior changes, also run the targeted parity or subprocess checks that cover the edited path.

## Documentation Rule

If behavior changes, update the closest documentation at the same time:

- product/user-facing behavior: `README.md`
- development workflow: `CONTRIBUTING.md`
- runtime/contracts: `docs/*.md`, `server/README.md`, `schemas/README.md`
- demo-specific behavior: `demo/<name>/README.md`
