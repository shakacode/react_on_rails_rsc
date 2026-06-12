---
name: downstream-e2e
description: "Run downstream integration checks through scripts/e2e/downstream.sh when it exists, or report the current #59 blocker stub."
argument-hint: '[downstream args]'
---

# Downstream E2E

Use this skill when validating `react-on-rails-rsc` against a downstream app or
consumer fixture.

## Current Status

This skill is currently a documented stub because `scripts/e2e/downstream.sh`
does not exist on `origin/main` as of the issue #67 setup work.

Blocker: [#59](https://github.com/shakacode/react_on_rails_rsc/issues/59)

Do not claim a downstream e2e pass from this skill while the script is missing.

## When The Script Exists

From the repository root:

```bash
bash scripts/e2e/downstream.sh "$@"
```

If the script provides `--help`, read it first and follow the script's current
interface. The exact downstream app selection interface is UNKNOWN until #59
lands.

## Expected Workflow

1. Read `AGENTS.md` for the current validation policy.
2. Confirm `scripts/e2e/downstream.sh` exists:
   ```bash
   test -f scripts/e2e/downstream.sh
   ```
3. If the script prints its own usage with `--help`, prefer that interface over
   this stub text.
4. Run the downstream script with the requested arguments.
5. Report the exact command, package version or local package source tested,
   downstream target, and result.
6. If the script is missing, report the #59 blocker and do not substitute an
   ad hoc downstream smoke test.

## Stub Output

When the script is still missing, report:

```text
BLOCKED downstream-e2e: scripts/e2e/downstream.sh is not present. Track #59 before using downstream e2e as a merge or release gate.
```
