---
name: verify-pr-fix
description: >-
  Manually verify that a bug-fix PR actually works by reproducing the failure before the fix and confirming it is gone after, with captured evidence, then posting findings to the PR (and optionally the linked issue). Use when asked to manually verify a PR/fix, reproduce an issue and its fix, confirm a fix works end to end, or capture before/after proof of a change.
argument-hint: '[PR URL or number]'
---

# Verify PR Fix

Prove a bug-fix PR works by **reproducing the failure first, then showing the fix removes it**, with
evidence a reader can check. A fix that "passes" means nothing unless you first showed the bug.

This is behavioral verification, distinct from the local lint/test loop in `.agents/skills/verify/SKILL.md`
(`$verify`) and from review skills (`$adversarial-pr-review`, `$post-merge-audit`). Use this when the
question is "does the fix actually fix the reported problem?", not "does it lint and pass CI?".

Memorable invocation: `$verify-pr-fix <PR>` or "manually verify this fix and reproduce the issue".

## Core principles

- **Show the bug before the fix.** Always capture a failing "before" and a passing "after" of the _same_
  reproduction. Skipping the "before" is the most common way a verification lies.
- **Faithful over convenient.** Reproduce through the same code path / API the product uses. If you must
  build a harness, build it on the real mechanism (the actual exported module, the real webpack/rspack
  plugin instance, the real loader/transform pipeline), not a paraphrase of it.
- **Evidence before assertions.** Never claim "verified" without captured output, a state check
  (`ps`/`pgrep`, HTTP status, DOM, exit code), or a screenshot. Paste the real output, including PIDs,
  codes, and timings. Never fabricate or assume output (see `AGENTS.md`).
- **State what you did NOT exercise.** If the reproduction is mechanism-level rather than the full app, say
  so plainly and name the residual-risk path. Honesty about scope is part of the deliverable.
- **Reproduce the actual condition.** Many bugs are intermittent or race-dependent. Recreate the triggering
  condition deterministically (the right input, a settle delay, the blocking state, the concurrency) before
  concluding "no repro". A clean run can mean you never triggered the bug, not that it is absent.
- **Leave the machine clean.** Kill every process you spawned and remove scratch files. Verify with
  `pgrep`/`ps` that nothing leaked.

## Instructions

1. **Read the PR and the linked issue.** `gh pr view <n> --json title,body,files,commits,url,state` and
   `gh issue view <linked> --json title,body,url`. Extract: the claimed bug, the expected vs actual
   behavior, the reproduction the reporter described, and the validation the author already ran (look for a
   "Manual / Residual Risk" or "Validation" section — verify what they left UNKNOWN).
2. **Locate the changed surface.** Read the diff (`gh pr diff <n>` or the files in the worktree). Identify
   the exact behavioral change and the smallest observable signal that distinguishes broken from fixed
   (an orphaned process, an HTTP 500 vs 200, a hydration mismatch, a cache key collision, an exit code).
3. **Choose the cheapest faithful reproduction**, in this order:
   - **End-to-end through the real build** when feasible — highest fidelity. For this repo that means
     running the plugin inside an actual webpack/rspack compilation (a small fixture config that loads the
     real plugin from `src`/`dist`) and inspecting the emitted output (the client/server manifest, the
     module graph, chunk groups, generated references), or running the relevant `tests/` suite that drives
     the module end to end. Build with `yarn build` first when the reproduction needs the compiled `dist`.
   - **Minimal faithful harness** when standing up a full compilation is too heavy (needs large fixtures,
     real bundles, or external services). Build it on the **same real API** the product uses — import the
     actual exported module/plugin/loader under test and drive it directly — and label it mechanism-level.
     A jest test in `tests/` is usually the right shape: `yarn jest <path>` for a non-RSC test, or
     `NODE_CONDITIONS=react-server yarn jest <path>` for a `tests/*.rsc.test.*` RSC test (the
     `react-server` condition is what loads the server-flavored module graph).
4. **Reproduce the bug (the "before").** Run the reproduction against pre-fix behavior. Get pre-fix code by
   the least invasive means: check out the parent commit in a scratch worktree, `git stash` an uncommitted
   change, check out one file at its pre-fix revision (`git checkout <fix-commit>~1 -- <file>`), or (for a
   harness) model the pre-fix path explicitly. Capture the failure. If it does not fail, you have not
   reproduced it — recreate the triggering condition (input, timing, blocking, concurrency) and retry
   before concluding anything.
5. **Verify the fix (the "after").** Restore the post-fix code first (`git stash pop`,
   `git checkout HEAD -- <file>`, or leave the worktree), then run the identical reproduction. Capture the
   now-passing result and confirm the specific signal flipped (orphans 6/6 -> 0/6, exit code, status, DOM).
   Confirm `git status` is clean so the "after" really ran against post-fix code.
6. **Capture evidence.** Save real terminal output — the failing jest run, the diff between pre/post-fix
   emitted manifests, the build log, the inspected chunk graph. For a shareable visual of terminal results
   you may render the captured output with the visualize tool, but the render must reproduce real output
   verbatim — never stage numbers.
7. **Clean up.** Kill spawned processes, remove scratch dirs/worktrees, and confirm nothing leaked
   (`pgrep -fl <marker>` should report none).
8. **Report to the PR.** Post a comment with the structured format below. Before posting to GitHub (an
   outward-facing action), confirm with the user unless they already told you to post. Write the body to a
   temp file and use `gh pr comment <n> --body-file` (avoids inline-formatting issues; see global Git
   workflow rules).
9. **Cross-link the issue (optional).** If asked, comment on the linked issue with a 2-3 sentence summary
   and a link to the PR comment URL returned by step 8: `gh issue comment <n> --body-file`.

## Reproduction tactics by change type

- **Webpack/rspack plugin output** (manifests, module graph, chunk groups, client/server references): run
  the plugin inside a small fixture compilation, then diff the emitted artifact pre/post-fix — assert on
  the exact manifest entries, reference IDs, or chunk-group membership that distinguishes broken from fixed.
- **SSR / hydration / RSC** (server vs client module resolution, the `react-server` graph, streaming,
  emitted references): drive the affected module through a `tests/*.rsc.test.*` jest run with
  `NODE_CONDITIONS=react-server`, or compare the server-flavored output against the client-flavored output.
  Compare what the plugin emits for the server build vs the client build rather than booting a Rails app.
- **Loaders / transforms** (source rewriting, directive handling like `"use client"`/`"use server"`):
  feed the loader/transform the real input source and assert on the exact transformed output.
- **Caching / dedupe / digests** (chunk keys, reference IDs, dedupe of repeated modules): construct the
  colliding or repeated inputs and assert hit/miss and that the key/ID format matches the real code.
- **Types-only changes**: usually covered by `yarn build` (which runs `tsc`); behavioral reproduction is
  normally not warranted — say so rather than staging a fake one.

## Environment notes

- **Pre-fix-on-one-file tactic** (cheap before/after for an already-merged PR): when the fix is in a single
  file and the PR added regression tests, run the post-fix test against the pre-fix file —
  `git checkout <fix-commit>~1 -- <file>`, run the test (`yarn jest <path>`, prefixing
  `NODE_CONDITIONS=react-server` for a `tests/*.rsc.test.*` file); it should fail on exactly the new tests.
  Then **always restore** with `git checkout HEAD -- <file>` and confirm `git status` is clean before
  moving on.
- **Read the changed function from git, not from memory**: when a harness needs the exact pre/post logic
  (a regex, a manifest key format, a reference ID scheme), extract it verbatim with `git show <rev>:<file>`
  so the reproduction can't drift from the real code.

## When NOT to use this skill

- Docs, comments, CHANGELOG, CI/workflow plumbing, benchmark tooling, refactors with no behavioral change,
  license-header enforcement, and pure type narrowing rarely have a user-observable runtime symptom to
  reproduce. Route those to `$verify` (local checks) or a review skill instead, and say why a behavioral
  repro adds nothing.

## Output format (PR comment)

````markdown
## Manual verification: reproduced the bug and confirmed the fix ✅ / ❌

<one line on what was verified and how (full app vs mechanism-level harness)>

### Reproduction

<how the bug was triggered; the key condition that makes it deterministic>

### Results

| Scenario              | Behavior   | Result          |
| --------------------- | ---------- | --------------- |
| Pre-fix, <condition>  | <observed> | <BROKEN signal> |
| Post-fix, <condition> | <observed> | <FIXED signal>  |

```text
<real captured output, before and after>
```

### Caveat

<what was NOT exercised; the residual-risk path that remains UNKNOWN>
````

Keep the comment evidence-first and honest about scope. End behavioral claims with the captured proof, not
adjectives.
