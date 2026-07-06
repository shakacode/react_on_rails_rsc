---
name: rsc-verify-pr-fix
description: Manually verify a react-on-rails-rsc bug-fix PR by reproducing the failure before the fix and confirming the same RSC/plugin signal passes after.
argument-hint: '[PR URL or number]'
---

# RSC Verify PR Fix

Prove a bug-fix PR works by reproducing the failure first, then showing the fix
removes it with evidence a reviewer can check. A passing test is not enough
unless the same reproduction failed before the fix.

## RSC-Specific Reproduction Order

1. Read the PR and linked issue:
   ```bash
   gh pr view <PR> --json title,body,files,commits,url,state
   gh issue view <ISSUE> --json title,body,url
   ```
2. Identify the changed RSC surface: webpack/rspack plugin behavior, loaders,
   client/server manifest output, Flight runtime behavior, stylesheet/resource
   hints, package exports, release artifact behavior, or docs-only behavior.
3. Prefer a faithful reproduction through the real package path:
   - a targeted `yarn jest <path>` test for non-RSC behavior;
   - `NODE_CONDITIONS=react-server yarn jest <path>` for `*.rsc.test.*`;
   - a small webpack/rspack fixture that uses the real plugin/loader and
     inspects emitted output;
   - `yarn build` first when the reproduction needs compiled `dist/` files.
4. Capture the before state from the parent commit, a scratch worktree, or a
   reverted file. Do not report success unless the bug signal fails before.
5. Restore the PR fix and run the identical reproduction. Confirm the specific
   signal flips from failing to passing.
6. Clean up scratch files, worktrees, and spawned processes. Finish with the
   exact commands run and the captured before/after output.

State any residual risk plainly, especially when the reproduction is
mechanism-level instead of a full downstream React on Rails app.
