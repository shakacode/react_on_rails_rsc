# Agent Workflow Scripts

Standard entry points that portable agent-workflow skills call, so a skill can
run `.agents/bin/<name>` in any repo without knowing this repo's specific
commands. Each script is a thin, repo-owned wrapper. A script that is **absent**
means that capability is n/a here.

| Script | Purpose | This repo runs |
| --- | --- | --- |
| `setup` | Install dependencies | `yarn install` |
| `validate` | Pre-push gate (run before pushing) | `build` + `test` |
| `test` | Run tests | `yarn test` (`test:rsc` + `test:non-rsc`) |
| `build` | Build / type-check | `yarn build` (tsc; also the typecheck) |
| `lint` | Lint / format | n/a — eslint/prettier are not wired into a blocking gate |

For one RSC test file: `NODE_CONDITIONS=react-server yarn jest <path>` (for
`*.rsc.test.*`). Non-command policy lives in [`../agent-workflow.yml`](../agent-workflow.yml).
