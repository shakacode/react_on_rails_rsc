# Agent Workflow Scripts

Standard entry points that portable agent-workflow skills call, so a skill can
run a fixed script name in any repo without knowing this repo's specific
commands. Each script is a thin, repo-owned wrapper. A script that is **absent**
means that capability is n/a here.

Shaka runs `setup`, `validate`, and `test` from [`../shaka/bin/`](../shaka/bin/).
The same names here are compatibility shims for shared skills that still call
this directory; each one runs its counterpart there.

| Script | Purpose | This repo runs |
| --- | --- | --- |
| `setup` | Install dependencies | `yarn install` (shim) |
| `validate` | Pre-push gate (run before pushing) | `yarn build` + `yarn test` (shim) |
| `test` | Run tests | `yarn test` (`test:rsc` + `test:non-rsc`) (shim) |
| `build` | Build / type-check | `yarn build` (tsc; also the typecheck) |
| `lint` | Lint / format | n/a — eslint/prettier are not wired into a blocking gate |
| `shared-skill-dir` | Resolve an installed/shared skill directory | `<path-to-skill>` or a clear error |

For one RSC test file: `NODE_CONDITIONS=react-server yarn jest <path>` (for
`*.rsc.test.*`). These wrappers are the portable command interface. Typed Shaka
policy lives in [`../shaka/config.yml`](../shaka/config.yml); human-only
constraints stay in [`../../AGENTS.md`](../../AGENTS.md).
