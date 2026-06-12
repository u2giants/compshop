# Claude Code Notes

Read `AGENTS.md` first. It is the canonical operating guide and documentation router for this repository.

Use `.claudeignore` to avoid loading generated files, build artifacts, historical migration docs, and binary assets unless the task explicitly requires them.

SSH is not the normal deployment path. Routine deploys go through GitHub Actions and Coolify as described in `AGENTS.md` and `docs/deployment.md`; use SSH only for exceptional host recovery or direct production maintenance when explicitly requested.

Prefer small commits on `main`. Before pushing, check `git status --short --branch` and verify local/remote divergence.
