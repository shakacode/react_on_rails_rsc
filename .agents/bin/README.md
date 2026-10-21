# Agent Workflow Scripts

Repository helpers. Shaka's `setup`, `validate`, and `test` commands live in
[`../shaka/bin/`](../shaka/bin/).

| Script | Purpose | This repo runs |
| --- | --- | --- |
| `build` | Build / type-check | `yarn build` (tsc; also the typecheck) |
| `shared-skill-dir` | Resolve an installed/shared skill directory | `<path-to-skill>` or a clear error |

For one RSC test file: `NODE_CONDITIONS=react-server yarn jest <path>` (for
`*.rsc.test.*`). Typed Shaka policy lives in
[`../shaka/config.yml`](../shaka/config.yml); human-only constraints stay in
[`../../AGENTS.md`](../../AGENTS.md).
