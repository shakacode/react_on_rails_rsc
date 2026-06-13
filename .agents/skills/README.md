# Agent Skills

These skills were ported from the [react_on_rails](https://github.com/shakacode/react_on_rails)
repo so `react_on_rails_rsc` can run the same batch/review/verification workflows. `AGENTS.md`
(repo root) is the canonical agent policy; `.claude/skills` is a symlink to this directory so Claude
Code exposes each skill as a slash command, and `.agents/workflows/` holds the deeper operating
models the skills point to.

Invoke a skill with its `$name` (e.g. `$pr-batch`, `$plan-pr-batch`, `$adversarial-pr-review`) or the
matching Claude Code slash command.

For the maintainer-facing guide to choosing and running these skills, see
[`internal/contributor-info/agent-pr-batch-skills.md`](../../internal/contributor-info/agent-pr-batch-skills.md).
For the workflow adoption and retargeting checklist, see
[`internal/contributor-info/agent-workflow-adoption.md`](../../internal/contributor-info/agent-workflow-adoption.md).

## Adaptation status

The originals assume a Ruby/Rails monorepo (rspec, rubocop, rake, shakapacker, a Pro tier, a
release-tracker/confidence-block merge protocol, and CI-expansion labels). They were retargeted to
this repo's toolchain: yarn + jest (`yarn test`, `yarn test:rsc`/`test:non-rsc`), `yarn build` (tsc)
as the typecheck, and the changelog-driven `scripts/release.sh` npm release. The simplified merge model
(full `gh pr checks` list as the gate, AI reviewers advisory, low-risk batch-closeout auto-merge /
high-risk maintainer-gated) lives in `AGENTS.md` and `.agents/workflows/pr-processing.md`.

| Skill | Status |
| --- | --- |
| `pr-batch`, `plan-pr-batch` | Adapted — batch launch/planning; coherent with this repo's merge model |
| `address-review`, `adversarial-pr-review`, `post-merge-audit`, `evaluate-issue` | Portable — generic GitHub review/triage flows, no repo-tooling assumptions |
| `autoreview` | Adapted — validation commands and risk classes retargeted to yarn/jest |
| `verify`, `run-ci` | Adapted — local verification / CI-reproduction retargeted to `yarn test` + `yarn build` |
| `verify-release` | Adapted — runs `yarn verify:artifacts` / `scripts/verify-release.sh` from #61/#77 |
| `run-e2e` | Adapted — runs `scripts/e2e/run.sh` with `RSC_E2E_BUNDLER=webpack|rspack|both` |
| `downstream-e2e` | Stub — documents the intended downstream e2e wrapper and blocks on #59 |
| `react-upgrade` | Legacy — emergency vendored-runtime maintenance only; not the Option 4 patch-file fallback |
| `triage` | Manual stub — refreshes `docs/open-rsc-work-status.md` from live `gh` state and reports `UNKNOWN` for unverifiable facts |
| `verify-pr-fix` | Adapted — before/after reproduction reframed around jest + plugin output |
| `update-changelog` | Adapted — Keep-a-Changelog format + `scripts/release.sh` release flow |
| `stress-test` | **Not adapted** — still Rails/Pro/node-renderer-specific; reference only until rewritten for this package |

When extending these, keep `AGENTS.md` as the single source of truth for commands and merge policy, and
keep skill ↔ workflow cross-references in sync.
