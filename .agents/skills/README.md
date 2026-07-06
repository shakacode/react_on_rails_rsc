# Agent Skills

This directory is for `react_on_rails_rsc`-specific skills and deliberate local overrides only.
Shared batch, review, verification, audit, and changelog skills come from the installed/shared
`agent-workflows` pack so Codex does not show duplicate repo-local and personal skill entries.
`AGENTS.md` (repo root) is the canonical agent policy; `.claude/skills` is a symlink to this
directory so Claude Code exposes the local RSC workflows as slash commands, and `.agents/workflows/`
holds deeper operating models for agents without skill support.

Invoke shared skills with their `$name` (for example `$pr-batch`, `$plan-pr-batch`, or
`$adversarial-pr-review`). When a script needs a shared skill directory, resolve it with
`.agents/bin/shared-skill-dir <skill-name>`.

For the maintainer-facing guide to choosing and running these skills, see
[`internal/contributor-info/agent-pr-batch-skills.md`](../../internal/contributor-info/agent-pr-batch-skills.md).
For the workflow adoption and retargeting checklist, see
[`internal/contributor-info/agent-workflow-adoption.md`](../../internal/contributor-info/agent-workflow-adoption.md).

## Local Skill Status

The shared skills read this repo's commands and policy from `AGENTS.md`, `.agents/bin/`, and
`.agents/agent-workflow.yml`. Local skills below cover RSC-specific release, e2e, triage, and legacy
runtime maintenance workflows.

| Skill | Status |
| --- | --- |
| `verify-release` | Adapted — runs `yarn verify:artifacts` / `scripts/verify-release.sh` from #61/#77 |
| `run-e2e` | Adapted — runs `scripts/e2e/run.sh` with `RSC_E2E_BUNDLER=webpack|rspack|both` |
| `downstream-e2e` | Stub — documents the intended downstream e2e wrapper and blocks on #59 |
| `react-upgrade` | Legacy — emergency vendored-runtime maintenance only; not the Option 4 patch-file fallback |
| `rsc-triage` | Manual stub — refreshes `docs/open-rsc-work-status.md` from live `gh` state and reports `UNKNOWN` for unverifiable facts |
| `rsc-update-changelog` | Adapted — Keep-a-Changelog format + `scripts/release.sh` npm release flow |
| `rsc-verify-pr-fix` | Adapted — before/after reproduction reframed around jest, plugin output, and RSC package behavior |
| `stress-test` | **Not adapted** — still Rails/Pro/node-renderer-specific; reference only until rewritten for this package |

When extending these, keep `AGENTS.md` as the single source of truth for commands and merge policy, and
keep skill ↔ workflow cross-references in sync.
