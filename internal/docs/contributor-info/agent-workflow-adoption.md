# Agent Workflow Adoption Guide

Use this guide when maintaining the PR skill suite in this repository or when another repository wants
to adopt it. The goal is to copy the reusable workflow structure, then replace every repository-specific
command, label, path, risk category, and release rule with the target repository's real behavior.

Do not copy React on Rails workflow text blindly. This package is a standalone Yarn Classic +
TypeScript package named `react-on-rails-rsc`; it has no Ruby, Rails, gem, Pro, release-tracker,
release-mode label, or CI-expansion command workflow.

## What This Repository Adopted

PR 74 originally ported the shared agent skill suite from `shakacode/react_on_rails` into this
package. The current model keeps portable shared skills in the installed/shared `agent-workflows`
pack and keeps only RSC-specific skill front doors in this repository, so Codex does not show
duplicate repo-local and personal skill entries. The workflow layers are:

- [`AGENTS.md`](../../../AGENTS.md) - canonical repo policy for commands, testing, code style, git
  safety, merge qualification, release model, changelog rules, and documentation boundaries.
- [`.agents/skills/`](../../../.agents/skills/README.md) - repo-local RSC-specific skill entry points
  and deliberate local overrides only.
- [`.agents/bin/shared-skill-dir`](../../../.agents/bin/shared-skill-dir) - helper for resolving an
  installed/shared skill directory when a script needs a filesystem path.
- [`.agents/workflows/`](../../../.agents/workflows/pr-processing.md) - deeper reusable workflows for
  agents without skill support or for long prompts that should not live in a skill front door.
- [`.claude/skills`](../../../.claude/skills) - symlink to `.agents/skills` so Claude Code can expose
  local RSC-specific workflows as slash commands. Install the shared pack in the agent home for
  shared slash commands.

The missing docs from the original React on Rails port are now represented by:

- [PR Skill Guide](./agent-pr-batch-skills.md) - which skill to use, how to launch batches, and how to
  close out with evidence.
- [Agent Coordination Backend](./agent-coordination-backend.md) - pointer to the private shared
  backend for claim, heartbeat, status, and dependency state.
- [Multi-Batch Operations](./multi-batch-operations.md) - operator guide for concurrent batches
  across machines, launch surfaces, or the React on Rails / RSC repos.
- This adoption guide - how to keep the workflow suite coherent and how to retarget it elsewhere.

## Required Baseline Files

Install the shared `agent-workflows` pack for portable skills, then copy or maintain these
repo-local files together:

| File | Purpose |
| --- | --- |
| [`AGENTS.md`](../../../AGENTS.md) | Canonical repository policy and command source. |
| [`.agents/skills/README.md`](../../../.agents/skills/README.md) | Human-facing index of skill status and adaptation notes. |
| [`.agents/bin/shared-skill-dir`](../../../.agents/bin/shared-skill-dir) | Resolve installed/shared skill directories for helper invocations. |
| [`.agents/skills/rsc-triage/SKILL.md`](../../../.agents/skills/rsc-triage/SKILL.md) | RSC backlog/status refresh workflow. |
| [`.agents/skills/rsc-verify-pr-fix/SKILL.md`](../../../.agents/skills/rsc-verify-pr-fix/SKILL.md) | RSC/package-specific manual bug-fix reproduction and confirmation. |
| [`.agents/skills/rsc-update-changelog/SKILL.md`](../../../.agents/skills/rsc-update-changelog/SKILL.md) | Changelog and npm release-heading workflow. |
| [`.agents/skills/verify-release/SKILL.md`](../../../.agents/skills/verify-release/SKILL.md) | Release artifact verification. |
| [`.agents/skills/run-e2e/SKILL.md`](../../../.agents/skills/run-e2e/SKILL.md) | Package-level end-to-end verification. |
| [`.agents/skills/downstream-e2e/SKILL.md`](../../../.agents/skills/downstream-e2e/SKILL.md) | Downstream React on Rails verification stub. |
| [`.agents/skills/react-upgrade/SKILL.md`](../../../.agents/skills/react-upgrade/SKILL.md) | Emergency vendored-runtime maintenance workflow. |
| [`.agents/workflows/pr-processing.md`](../../../.agents/workflows/pr-processing.md) | Full issue/PR processing operating model. |
| [`.agents/workflows/address-review.md`](../../../.agents/workflows/address-review.md) | Reusable review-feedback prompt for non-skill agents. |
| [`.agents/workflows/adversarial-pr-review.md`](../../../.agents/workflows/adversarial-pr-review.md) | Reusable adversarial review prompts and comparisons. |
| [`.agents/workflows/post-merge-audit.md`](../../../.agents/workflows/post-merge-audit.md) | Reusable post-merge audit prompts and issue-plan templates. |
| [`.agents/workflows/evaluate-issue.md`](../../../.agents/workflows/evaluate-issue.md) | Lightweight evaluation prompt for agents without skill support. |
| [`internal/docs/contributor-info/agent-coordination-backend.md`](./agent-coordination-backend.md) | Private coordination backend pointer, setup, heartbeat, status, and fallback rules. |
| [`internal/docs/contributor-info/multi-batch-operations.md`](./multi-batch-operations.md) | Operator model for concurrent batches across machines, launch surfaces, and repos. |

Keep [`$stress-test`](../../../.agents/skills/stress-test/SKILL.md) out of the required baseline until it
is rewritten for this package. It still assumes React on Rails Pro, Rails apps, and node-renderer
surfaces.

## Retargeting Checklist

When moving the workflow suite into another repository, replace these before considering the adoption
complete:

- Repository name, package names, default branch, and release branch model.
- Setup, install, build, typecheck, lint, test, docs, and generated-artifact commands.
- Package managers and lockfile rules.
- Directory boundaries for source, tests, generated output, public docs, internal docs, examples, and
  release tooling.
- CI workflow names and which checks are required or advisory.
- Whether `gh pr checks --required` is meaningful in that repository. It is not meaningful here.
- Merge strategy, branch naming, PR title convention, and changelog policy.
- Release model and release script behavior.
- Review bots that can leave comments and how their comments should be triaged.
- Which review systems are advisory and what counts as a confirmed blocker.
- High-risk file classes, such as workflows, dependencies, lockfiles, build config, release tooling,
  shared runtime code, public API, and security-sensitive surfaces.
- Label vocabulary, including whether `needs-customer-feedback`, `codex-ready`, `codex-wip`,
  `codex-pending-question`, `full-ci`, or `benchmark` actually exist.
- Cross-repo coordination backend, agent-id format, claim/heartbeat/status lifecycle, and
  directory-routing rules if the repo will share multi-batch operations with other repos.
- Full-CI trigger mechanism, if any. This package intentionally does not have `+ci-*` PR comment
  commands.
- Follow-up issue policy. This package uses `Follow-up:` titles and prefers one bundled deferred-work
  summary before creating issues.
- Tool-specific docs that should be thin wrappers around `AGENTS.md`.

## What Not To Copy From React On Rails

These concepts from `shakacode/react_on_rails` do not apply to this package unless a maintainer
explicitly adds them later:

- Ruby, Rails, gem, Shakapacker, React on Rails Pro, SSR pool, or node-renderer commands.
- `rspec`, `rubocop`, `rake`, `bin/ci-local`, or `script/ci-changes-detector` commands.
- Release-tracker issues, release-mode labels, confidence-block protocols, or merge-confidence blocks.
- `+ci-run-full`, `+ci-stop-full`, `+ci-status`, `+ci-skip-full`, `full-ci`, or `benchmark` workflows.
- Required status-check assumptions based on `gh pr checks --required`.
- Pro/core boundary language except where this package's own public API requires a similar distinction.
- React on Rails docs sidebar, Docusaurus, RubyGems, or Rails generator instructions.

## Local Adaptation Rules

For this repository, the adapted replacement rules are:

- Use `yarn`, never `npm` or `pnpm`.
- Use `yarn build` as the typecheck.
- Use `yarn test` for the full test gate, or targeted `yarn jest <path>` while iterating.
- Prefix RSC test files with `NODE_CONDITIONS=react-server`.
- Treat `dist/` as generated build output and do not commit it.
- Treat docs-only changes as requiring `git diff --check`, with no build or test gate unless examples,
  generated docs, scripts, or config changed.
- Use the full `gh pr checks <PR>` list for merge readiness.
- Treat AI reviewers as advisory unless they identify a confirmed blocker.
- Use the private `shakacode/agent-coordination` backend for ShakaCode-internal concurrent batches
  when `agent-coord status` is available; otherwise report private state as `UNKNOWN` and use public
  claim comments only as advisory fallback state.
- Update `CHANGELOG.md` only for user-visible changes.
- Run `yarn release:dry-run` before a release, and release from the top `CHANGELOG.md` version heading.

## Sync Policy

Policy changes should flow in this order:

1. Update [`AGENTS.md`](../../../AGENTS.md).
2. Update affected skill front doors under [`.agents/skills/`](../../../.agents/skills/README.md).
3. Update deeper workflows under [`.agents/workflows/`](../../../.agents/workflows/pr-processing.md).
4. Update [PR Skill Guide](./agent-pr-batch-skills.md) and this guide if user-facing skill selection,
   launch rules, adoption rules, or validation guidance changed.
5. Update [Agent Coordination Backend](./agent-coordination-backend.md) and
   [Multi-Batch Operations](./multi-batch-operations.md) when coordination
   state, private backend behavior, agent ids, or cross-repo routing changed.
6. Update Claude compatibility links or prompts if they exist.
7. Run the verification appropriate for the changed surface.

Do not let a skill, workflow, and `AGENTS.md` describe different merge gates or validation commands.
When in conflict, `AGENTS.md` wins and the docs should be corrected.

## Dry-Run Validation

Before declaring a new adoption or major skill-suite change ready, run at least one dry run that does
not write GitHub state:

- Ask an agent to process a low-risk issue and stop before opening a PR.
- Ask an agent to run `$plan-pr-batch` from a label or search query and confirm it stops with an exact
  target list and goal prompt.
- Ask an agent to run `$address-review` on a PR and stop after triage.
- Ask an agent to run `$adversarial-pr-review` as report-only and confirm it does not edit code or
  write GitHub state.

The dry run should prove that the agent uses the target repo's real commands, reports `UNKNOWN` for
unverified facts, does not invent missing CI machinery, and does not create follow-up issues by default.

## Suggested Adoption PR Summary

```markdown
## Summary

- add canonical agent instructions in `AGENTS.md`
- add PR batch, issue evaluation, review handling, adversarial review, audit, verification, and
  changelog skills under `.agents/skills/`
- add reusable PR processing, review triage, adversarial review, post-merge audit, and issue evaluation
  workflows under `.agents/workflows/`
- document local validation, merge-readiness, and release rules for this repository
- document how to choose and maintain the PR skill suite

## Validation

- `git diff --check`
- dry-run issue or PR triage without code changes
```
