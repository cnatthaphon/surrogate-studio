# Contributing

This repo uses `main` as the single source of truth.

## Working Rule

- Keep `main` deployable.
- Do not commit directly to `main` unless the change is a deliberate maintainer action.
- Merge finished work back into `main`, then delete the branch.
- Prune stale local and remote branches after merge.

## Branch Naming

Branch names should describe the change, not the tool or agent that made it.

Use one of these prefixes:

- `fix/...` for bugs
- `feat/...` for new features
- `docs/...` for documentation
- `refactor/...` for internal cleanup
- `test/...` for test-only work
- `chore/...` for maintenance

Examples:

- `fix/bug-7-stack-trace`
- `docs/readme-jupyterlite`
- `feat/training-worker-diagnostics`

Avoid names like:

- `claude/...`
- `codex/...`
- `my-branch`
- `tmp/...`

## Branch Workflow

Start from an up-to-date `main`:

```bash
git checkout main
git pull --ff-only origin main
git checkout -b fix/short-description
```

Keep the branch focused:

- one bug or one feature per branch
- no unrelated cleanup mixed into the same PR
- rebuild committed artifacts only when the source change requires it

## Pull Requests

Before opening a PR:

```bash
npm test
node --check dist/surrogate-studio.js
```

If the change affects browser behavior, also do the smallest meaningful manual smoke test.

PR rules:

- title should say what changed, not who changed it
- PR body should include a short summary and test plan
- if a branch is superseded by another PR, close it instead of leaving it open

## Merge Policy

- prefer squash merge for feature and bugfix PRs
- after merge, delete the remote branch
- fast-forward local `main` back to `origin/main`

Typical cleanup:

```bash
git checkout main
git pull --ff-only origin main
git branch -d fix/short-description
git fetch origin --prune
```

## Notes For Agent-Assisted Work

- the agent should follow the same naming rules as a human contributor
- branch names must reflect intent, not agent identity
- `main` must be left clean after review, merge, and cleanup
