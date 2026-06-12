---
name: run-ci
description: Analyze current branch changes against the base ref and run user-selected local checks (yarn test, yarn build). Use when the user asks to run, reproduce, or choose local CI checks.
argument-hint: '[base-ref]'
---

# Run CI Command

Analyze the current branch changes and run appropriate CI checks locally.

The only check that actually runs in CI is the "Run unit tests (jest)" workflow (`.github/workflows/unit-tests.yml`), which runs `yarn` then `yarn test` on Node 20.x. Locally, "run all CI jobs" means `yarn test` plus `yarn build` (the tsc typecheck). There is no local CI runner script in this repo, so this skill inspects the git diff itself and maps changed files to the relevant local checks.

## Argument Handling

This skill accepts an optional base-ref argument. If provided, use it instead of `origin/main` as the diff base; otherwise default to `origin/main`.

## Instructions

1. Inspect what changed on the branch with `git diff --name-only origin/main...HEAD` (substitute the optional base-ref argument when supplied) and `git status --short` for uncommitted work.
2. Map the changed files to the relevant local checks:
   - Source under `src/` or `tests/`, or any package/config change: `yarn test` (the full suite) or a targeted `yarn jest <path>`. For an `.rsc.test.` file, prefix the targeted run with `NODE_CONDITIONS=react-server`, e.g. `NODE_CONDITIONS=react-server yarn jest tests/foo.rsc.test.ts`.
   - Anything affecting TypeScript types or build output (`src/`, `tsconfig*.json`, type declarations): `yarn build` (this runs `tsc` and is the typecheck).
   - Documentation-only changes (`docs/`, `*.md`): typically no checks are required; note that in the output.
3. Show the user what the diff recommends.
4. Ask the user if they want to:
   - Run the recommended checks
   - Run all checks (same as CI on main): `yarn test` plus `yarn build`
   - Run a fast subset (a targeted `yarn jest <path>` for the changed area)
   - Run specific checks manually
5. Execute the chosen option and report results.
6. If any checks fail, offer to help fix the issues.

## Options

- Recommended checks — the subset implied by the changed files (see Instructions step 2)
- All checks — `yarn test` then `yarn build`; mirrors what merging to `main` is gated on
- Fast subset — a targeted `yarn jest <path>` (prefix `NODE_CONDITIONS=react-server` for an `.rsc.test.` file), skipping the full suite and build
- Custom base ref — pass a base ref as the argument to compare against a ref other than `origin/main`

Note: `.eslintrc.js` and `.prettierrc` exist in the repo, but eslint/prettier are not installed and there is no lint/format npm script, so lint/format is not a CI gate and is not run here.
