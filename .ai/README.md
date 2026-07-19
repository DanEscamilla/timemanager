# .ai — AI Handbook

Reference documentation for AI agents (and humans) working in this monorepo. It's the depth behind the short, auto-attached rules in [`.cursor/rules/`](../.cursor/rules/) and the root entrypoint [`AGENTS.md`](../AGENTS.md).

## How the handbook is wired

```
AGENTS.md                      # root entrypoint: map, golden rules, links
.cursor/rules/*.mdc            # auto-attached guidance (always-on + glob-scoped per app)
.ai/*.md                       # this folder: longer-form reference the rules link to
```

- `.cursor/rules/00-project-overview.mdc` and `monorepo-workflows.mdc` are `alwaysApply: true`.
- Per-app rules attach by glob (e.g. `apps/timemanager/**`) so they only load when relevant.
- Keep rules short; put depth here and link to it, so agent context stays lean.

## Contents

- [`architecture.md`](architecture.md) — system + data-flow diagram, how apps relate and their ports.
- [`conventions.md`](conventions.md) — package managers per runtime, Nx tag taxonomy, code style, testing, migrations.
- [`local-setup.md`](local-setup.md) — new-machine setup scripts, tool inventory, first run, script maintenance.
- [`workflows.md`](workflows.md) — run/build/seed/migrate each app + smoke checks.
- [`decisions.md`](decisions.md) — origin/history, locked-in decisions, out-of-scope/future work.

## Maintaining this handbook

When project structure, ports, runtimes, or conventions change, update the relevant `.ai/` doc and any affected `.cursor/rules/*.mdc`. Prefer editing existing docs over adding new ones. If a **new local-dev tool** is required on developer machines, also update [`local-setup.md`](local-setup.md) and `scripts/setup-*.sh`.
