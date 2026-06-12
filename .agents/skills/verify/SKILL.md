---
name: verify
description: Run a local verification loop for the current branch before creating or updating a PR, selecting checks from AGENTS.md and changed files. Use when asked to verify, test, or prepare PR changes.
---

# Verify Command

Run a local verification loop for the current branch before creating or updating a PR.

Use `/verify` for local pre-PR checks. Use `/run-ci` when you want to map the branch diff to CI job
selection and reproduce it locally.

## Instructions

1. Read `AGENTS.md` first. It is the canonical source for required commands, formatting, boundaries, and repository safety rules.
2. Inspect the current branch diff with `git status --short`, `git diff --name-only origin/main...HEAD`, and
   `git diff --stat origin/main...HEAD`.
3. Decide the required verification set that covers the changed surface area using the **Scope Guide** below.
4. Run each command in order and stop on the first failure. Report the failing command, the relevant error output, and the next fix to attempt.
5. After one or more edits for a failure, restart at the failed command and continue forward. Track a loop counter per
   command:
   - Increment the counter when the same command fails on the same first item (test name or type error) as the previous
     run.
   - Reset the counter when the first failing item changes or when you advance to a different command.
   - Stop and report after three consecutive cycles on the same item, unless the user asks you to keep going.
   - Stop immediately and report a regression if a later fix causes a command that previously passed to fail again on
     the same file, symbol, or test item. Ask the user how to proceed rather than attempting a blind revert.
   - Do not claim a failure is fixed until the command passes locally.
6. Finish with the exact commands run and their pass/fail status.

## Default Verification Order

Use this order unless the changed files make a narrower or broader set clearly appropriate:

1. Formatting and whitespace:
   - `git diff --check origin/main...HEAD` for committed branch content before creating or updating a PR; detects trailing whitespace and conflict markers
2. Build / typecheck:
   - `yarn build` - runs `tsc` (this IS the typecheck; there is no separate `type-check` script). Use `yarn build-if-needed` only when you just need dist artifacts present, not when verifying a type change.
3. Tests:
   - targeted `yarn jest <path>` for the changed area; prefix with `NODE_CONDITIONS=react-server` for an `.rsc.test.` file, e.g. `NODE_CONDITIONS=react-server yarn jest tests/foo.rsc.test.ts`
   - `yarn test` (runs `yarn test:rsc && yarn test:non-rsc`) when broad behavior changed or the touched files are not covered by a narrower targeted run; this is what CI runs

There is no enforced lint or format gate in this repo. `.eslintrc.js` and `.prettierrc` exist, but eslint/prettier are not installed and there is no lint/format npm script, so do not treat them as a required check.

## Scope Guide

- `src/` source changes: run `yarn build` (tsc) plus the targeted `yarn jest <path>` that covers the changed module; run `yarn test` if no narrower test covers it.
- `tests/` changes: run the affected test directly with `yarn jest <path>` (prefix `NODE_CONDITIONS=react-server` for `.rsc.test.` files), then `yarn test` if multiple test files or shared helpers changed.
- Type-only or `tsconfig*.json` changes: run `yarn build` to exercise the typecheck.
- `package.json`, `yarn.lock`, or build scripts under `scripts/`/`bin/`: run `yarn` to confirm install, then `yarn build` and `yarn test`.
- Documentation-only changes (`docs/`, `*.md`): no build or test gate is required; run `git diff --check origin/main...HEAD` and note in the output that no further checks apply.
- GitHub Actions workflow changes (`.github/workflows/`): there is no local workflow linter wired up here; review the YAML manually and note that in the output.
- Anything not listed above: apply the narrowest set of checks that covers the changed surface and explain the choice in the output.

## Output Format

Use this concise summary:

```text
Verification:
- PASS git diff --check origin/main...HEAD
- FAIL yarn build

Next fix:
- Resolve the reported tsc type error in src/..., then rerun `yarn build`.
```

If a command is intentionally skipped, explain why in one line. Prefer local verification over waiting for CI.
