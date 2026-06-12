---
name: run-e2e
description: "Run repo end-to-end checks through scripts/e2e/run.sh for webpack, rspack, or both bundlers."
argument-hint: '--bundler webpack|rspack|both'
---

# Run E2E

Use this skill when validating local end-to-end behavior for the webpack and
rspack integrations.

## Interface

Issue #57 landed `scripts/e2e/run.sh` in PR #85. The script selects bundlers
with `RSC_E2E_BUNDLER`:

```bash
RSC_E2E_BUNDLER=webpack bash scripts/e2e/run.sh
RSC_E2E_BUNDLER=rspack bash scripts/e2e/run.sh
RSC_E2E_BUNDLER=both bash scripts/e2e/run.sh
```

Default to `RSC_E2E_BUNDLER=both` for release or merge-readiness validation
unless the user asks for a narrower bundler lane.

## Expected Workflow

1. Read `AGENTS.md` for the current validation policy.
2. Confirm the script exists:
   ```bash
   test -f scripts/e2e/run.sh
   ```
3. If the script is missing, report that the checkout is inconsistent with
   current `main` / PR #85 instead of using a hand-rolled substitute.
4. Run the requested bundler lane using `RSC_E2E_BUNDLER`.
5. Report the exact command, working directory policy, and result.
