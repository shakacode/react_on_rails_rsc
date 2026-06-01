# Open RSC Work Investigation (2026-06-01)

Research-only snapshot for open issues and PRs in
`shakacode/react_on_rails_rsc`. This document is an `[INVESTIGATION]` sidecar:
it does not change implementation code and should not be merged as a runtime
fix.

## Current Map

| Item | Status | Recommended action |
|---|---|---|
| [#37](https://github.com/shakacode/react_on_rails_rsc/issues/37) | No open PR. Webpack and Rspack defaults still scan `.` recursively. | Create a focused fix PR for default `clientReferences` exclusions. |
| [#27](https://github.com/shakacode/react_on_rails_rsc/issues/27) | Appears fixed on `main` by [#33](https://github.com/shakacode/react_on_rails_rsc/pull/33) / `a747b7d`. | Close after maintainers confirm the fixed version has shipped. |
| [#22](https://github.com/shakacode/react_on_rails_rsc/issues/22) | No implementation PR. [#21](https://github.com/shakacode/react_on_rails_rsc/pull/21) fixes a symptom, not the algorithm question. | Keep as a separate manifest-algorithm investigation. |
| [#9](https://github.com/shakacode/react_on_rails_rsc/issues/9) | Partially covered by tests on `main` and [#11](https://github.com/shakacode/react_on_rails_rsc/pull/11). | Define a concrete checklist before closing. |
| [#35](https://github.com/shakacode/react_on_rails_rsc/pull/35) | Merge-clean but `CHANGES_REQUESTED`; stale behind `main`. | Address correctness review items and decide whether to land before or fold into #11. |
| [#21](https://github.com/shakacode/react_on_rails_rsc/pull/21) | Stacked on [#11](https://github.com/shakacode/react_on_rails_rsc/pull/11). CodeRabbit skipped review because base is non-default. | Fold into refreshed #11 or rebase after #11 lands. |
| [#11](https://github.com/shakacode/react_on_rails_rsc/pull/11) | Dirty, `CHANGES_REQUESTED`, very stale. | Rebuild/rebase from current `main`, then port accepted 19.0.x patches. |

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

## Comment Drafts

### #35

```md
I checked the open issue/PR mapping. #27 looks already fixed on `main` by #33 / `a747b7d`, where the plugin no longer breaks out when a CSS/non-JS file appears before the JS file. This PR preserves that behavior while adding CSS collection, so I would not block #27 on #35.

The real blockers here look like the requested changes already raised in review:
1. Avoid process-global `globalThis.__reactFlightClientManifest` for request-specific manifest lookup.
2. Preserve `react.client.reference` identity instead of exporting plain `__rfwn_wrap(...)` functions.
3. Treat `output.publicPath === "auto"` as empty/relative or warn.
4. Add at least one assertion around `__rfwn_wrap` / `__rfwn_css` output.
5. Finish the downstream smoke test.

Release-order note: if the 19.2.1 upgrade in #11 is still planned, we should either land this as a 19.0.x patch first and then rebuild/rebase #11 with these patches included, or port this work directly into the 19.2.1 branch and close this PR as superseded.
```

### #11

```md
This branch is now the release-order bottleneck. I recommend refreshing it from current `main` and rebuilding React 19.2.1 from a fork branch that includes all accepted RSC patches from 19.0.x.

Before merge, please include or port:
- #21's chunk-merge fix, otherwise the 19.2.1 manifest can regress the already-fixed chunk overwrite bug.
- The #27/#33 CSS-before-JS scan behavior: use `continue` for non-JS/hot-update files, not `break`.
- Any accepted #35 FOUC/runtime-chunk patches, if #35 is not merged first.
- Current `main` rspack/plugin fixes and tests.

I would treat CodeRabbit comments as blocking only where they affect correctness or CI: generated/vendored lint failures, unconditional export compatibility, and runtime file filtering. The style/nit comments can be skipped unless maintainers want cleanup.
```

### #21

```md
This PR is correctly stacked on #11 (`upgrade-to-react-v19.2.1`). I would not merge it independently until #11 is refreshed.

Suggested path:
1. Rebase or fold this change into the updated #11 branch.
2. Keep the fix as one logical patch in the React 19.2.1 rebuild.
3. Rerun `yarn test`.
4. Request a fresh review after the base is default/main or after the stack is updated, since CodeRabbit skipped review on the non-default base.

This remains useful for 19.2.1, even though current `main` already has the 19.0.x chunk-merge fix.
```

### #37

```md
I do not see an open PR covering this yet. The default `clientReferences` scan still falls back to `{ directory: ".", recursive: true }`, and the rspack plugin mirrors that behavior.

A focused fix PR should include:
- Default excludes for `node_modules`, `vendor/bundle`, `vendor/cache`, and generated asset/build directories.
- Coverage for both `RSCWebpackPlugin` and `RSCRspackPlugin`, or a clear note if webpack must be patched via the React fork/build artifact.
- A fixture with a fake `vendor/bundle/.../"use client"` file and an app `app/javascript/.../"use client"` file, asserting only the app file is discovered.
- A changelog/release note because this changes default discovery behavior in CI-like Rails installs.

App-level workaround remains passing explicit `clientReferences` rooted at `app/javascript`.
```

### #27

```md
This appears fixed on current `main` by #33 / `a747b7d`: the plugin now keeps scanning `chunk.files` when a non-JS file appears before the JS file. #35 also preserves this behavior while adding CSS collection.

I think this can be closed once maintainers confirm the fix is included in the intended published version, currently visible on `main` / `19.0.5-rc.3`.
```

### #22

```md
I recommend making this a separate `[INVESTIGATION]` PR rather than mixing it into #11/#21.

Suggested contents:
- Current behavior: path-based `resolvedClientFiles` plus chunk-group scanning.
- Known bugs addressed by current patches: overwrite/merge bug, CSS-before-JS scan bug, runtime chunk over-preload.
- Proposed dependency-type approach using `ClientReferenceDependency` / `AsyncDependenciesBlock`.
- Comparison with manual moduleGraph traversal from this issue comment.
- Test matrix: splitChunks shared module, CSS + JS chunk file ordering, `.mjs`, runtime chunk exclusion, duplicated module across chunk groups, concatenated modules if applicable.
- Decision section: whether to upstream to React, patch the fork only, or replace in the local wrapper.

Keep it investigation-only first; implementation can follow once maintainers agree on the manifest algorithm.
```
