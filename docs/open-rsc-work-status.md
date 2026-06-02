# Open RSC Work Status

Research-only snapshot for open issues and PRs in
`shakacode/react_on_rails_rsc`. This document is an `[INVESTIGATION]` sidecar:
it does not describe a ready-to-ship implementation, and the recommendations
below require separate implementation PRs.

This is a living status document. Last refreshed on 2026-06-02; re-check
mergeability, review comments, and CI before acting on status-sensitive
recommendations.

## Current Map

| Item | Type | Status | Next step by | Recommended action |
| --- | --- | --- | --- | --- |
| [#37](https://github.com/shakacode/react_on_rails_rsc/issues/37) | Issue | No open PR. Webpack and Rspack defaults still scan `.` recursively. | Maintainers or new assignee | Create a focused fix PR for default `clientReferences` exclusions. |
| [#27](https://github.com/shakacode/react_on_rails_rsc/issues/27) | Issue | Appears fixed on `main` by [#33](https://github.com/shakacode/react_on_rails_rsc/pull/33) / `a747b7d`. | Maintainers | Close after maintainers confirm the fixed version has shipped. |
| [#22](https://github.com/shakacode/react_on_rails_rsc/issues/22) | Issue | No implementation PR. [#21](https://github.com/shakacode/react_on_rails_rsc/pull/21) fixes a symptom, not the algorithm question. | Maintainers | Keep as a separate manifest-algorithm investigation. |
| [#9](https://github.com/shakacode/react_on_rails_rsc/issues/9) | Issue | Partially covered by tests on `main` and [#11](https://github.com/shakacode/react_on_rails_rsc/pull/11). | Maintainers | Define a concrete checklist before closing. |
| [#35](https://github.com/shakacode/react_on_rails_rsc/pull/35) | PR | Merge-clean but `CHANGES_REQUESTED`; stale behind `main`. | PR author + maintainers | Address correctness review items and decide whether to land before or fold into #11. |
| [#21](https://github.com/shakacode/react_on_rails_rsc/pull/21) | PR | Stacked on [#11](https://github.com/shakacode/react_on_rails_rsc/pull/11). CodeRabbit skipped review because base is non-default. | PR author + #11 owner | Fold into refreshed #11 or rebase after #11 lands. |
| [#11](https://github.com/shakacode/react_on_rails_rsc/pull/11) | PR | Dirty, `CHANGES_REQUESTED`, very stale. | PR author + maintainers | Rebuild/rebase from current `main`, then port accepted 19.0.x patches. |

## Release-Order Risks

- [#11](https://github.com/shakacode/react_on_rails_rsc/pull/11) is the
  bottleneck for React 19.2.1. It should include #21's chunk-merge fix, the
  #27/#33 CSS-before-JS scan behavior, current `main` Rspack/plugin fixes, and
  any accepted [#35](https://github.com/shakacode/react_on_rails_rsc/pull/35)
  FOUC/runtime-chunk patches.
- [#35](https://github.com/shakacode/react_on_rails_rsc/pull/35) can be
  overwritten by a later 19.2.1 rebuild unless those patches are ported into
  #11.
- [#21](https://github.com/shakacode/react_on_rails_rsc/pull/21) remains useful
  for 19.2.1, but it should not land independently while #11 is stale.

## #35 Blocking Review Themes

1. Avoid request-specific manifest lookup through
   `globalThis.__reactFlightClientManifest`.
2. Preserve `react.client.reference` identity; do not replace client references
   with plain `__rfwn_wrap(...)` functions.
3. Treat `output.publicPath === "auto"` as empty/relative or warn, otherwise CSS
   URLs can break.
4. Add assertion coverage around `__rfwn_wrap` / `__rfwn_css` output.
5. Finish the downstream smoke test.

## #22 Manifest Algorithm Investigation

Keep this separate from #11/#21 until maintainers agree on the algorithm.

Suggested implementation investigation should compare:

- Current behavior: path-based `resolvedClientFiles` plus chunk-group scanning.
- Fixed bugs on current branches: overwrite/merge bug, CSS-before-JS scan bug,
  and runtime chunk over-preload.
- Dependency-type approach using `ClientReferenceDependency` /
  `AsyncDependenciesBlock`.
- Manual `moduleGraph` traversal from the issue comment.
- Test matrix: splitChunks shared module, CSS + JS chunk file ordering, `.mjs`,
  runtime chunk exclusion, duplicated module across chunk groups, and
  concatenated modules if applicable.

Decision options:

- upstream to React;
- patch the fork only;
- replace or wrap behavior locally in `react_on_rails_rsc`.
