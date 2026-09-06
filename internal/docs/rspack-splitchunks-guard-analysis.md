# Rspack `splitChunks` Guard: History, Evidence, and Test Plan

Date: 2026-09-02

## Executive conclusion

The Rspack `splitChunks` guard addresses a real historical hydration symptom, but the explanation attached to it is not supported by Webpack, React Flight, Next.js, or this repository's current tests.

The strongest reconstruction is:

1. Rspack emitted a client-reference chunk plus sibling chunks created by `splitChunks`.
2. The Rspack manifest recorded only the chunk containing the client module, not the full chunk group.
3. React therefore did not know it had to load the sibling chunk and `requireModule` eventually failed with `Cannot read properties of undefined (reading 'call')`.
4. Commit [`1c03caac`](https://github.com/shakacode/react_on_rails_rsc/commit/1c03caac36e0ca726a14ec864806548108f3f7eb) fixed that problem by recording every sibling in the dependency chunk group.
5. Nineteen minutes later, commit [`1db11f10`](https://github.com/shakacode/react_on_rails_rsc/commit/1db11f10c21b54ed0d350f21529a5c4e325b5fca) added the guard, attributed the same error to an async-script race, and asserted that Webpack does not split `AsyncDependenciesBlock` chunks. It added no runtime reproduction for that second diagnosis.

The last assertion is false: this repository's Webpack integration test proves that Webpack can extract a shared sibling from client-reference chunks created with `AsyncDependenciesBlock`. React Flight preloads every `[chunk id, chunk file]` pair and waits for the resulting promises before it calls synchronous `requireModule`. Next.js likewise uses shared `splitChunks` cache groups and writes all required chunk-group files to its Flight manifest.

The guard is therefore best classified as a conservative workaround with a materially incorrect comment, not as a validated requirement. The cross-bundler Flight-to-hydration regression tests below now cover the actual failure mode, so this change removes the guard and lets Rspack honor the application's native `splitChunks` configuration.

## What the guard does

On client compilations, `RSCRspackPlugin` replaces the configured `optimization.splitChunks.chunks` selector. The wrapper delegates to the user's selector for ordinary chunks but returns `false` for every generated client-reference chunk name. That prevents shared JavaScript from being extracted from those chunks, making each client-reference chunk self-contained.

The cost is intentional duplication. A dependency used by several client boundaries can be copied into every generated chunk instead of being downloaded and cached once. This is especially undesirable for an app with many discoverable client boundaries or large common dependencies.

## Provenance and blame

The original investigation was part of [PR #36](https://github.com/shakacode/react_on_rails_rsc/pull/36), whose primary goals were server-bundle client-reference discovery, numeric module IDs, production export preservation, and replacing `addInclude` with the injection loader. The marketplace issue cited by the PR, [react-on-rails-demo-marketplace-rsc#64](https://github.com/shakacode/react-on-rails-demo-marketplace-rsc/issues/64), asks for Rspack support and validation; it does not document the claimed sibling-load race.

| Commit | Change | What it establishes |
| --- | --- | --- |
| [`1c03caac`](https://github.com/shakacode/react_on_rails_rsc/commit/1c03caac36e0ca726a14ec864806548108f3f7eb) | Changed manifest emission from per-module chunks to all sibling chunks in the dependency chunk group. | Directly fixes a missing-manifest-chunk cause of `undefined (reading 'call')`; describes this as matching Webpack. |
| [`1db11f10`](https://github.com/shakacode/react_on_rails_rsc/commit/1db11f10c21b54ed0d350f21529a5c4e325b5fca) | Excluded generated client-reference chunks from `splitChunks`. | Introduced the race explanation and Webpack-parity claim without a regression test. |
| [`453a5988`](https://github.com/shakacode/react_on_rails_rsc/commit/453a598839e313234a23d0d095e15a113d750308) | Replaced prefix matching with an exact generated-name set. | Makes the guard less likely to exclude unrelated chunks; does not validate why the guard is required. |
| [`cf8edb3f`](https://github.com/shakacode/react_on_rails_rsc/commit/cf8edb3f5d636562721f15c5f2669cfadd2c8796) | Squash-merged PR #36. | Current blame source for the guard and its explanatory comment. |
| [`c3fc7916`](https://github.com/shakacode/react_on_rails_rsc/commit/c3fc79162ad523714d1b469cd29ec0a095be50e8) / [PR #40](https://github.com/shakacode/react_on_rails_rsc/pull/40) | Treated an omitted `chunks` selector as Rspack's native `async` default instead of `all`; added selector-shape coverage. | Fixes a real default-semantics bug, but the tests also encode the guard's isolation behavior. |
| [`c151ea03`](https://github.com/shakacode/react_on_rails_rsc/commit/c151ea03df5a545f96cebd61148ba131032426d1) / [PR #165](https://github.com/shakacode/react_on_rails_rsc/pull/165) | Reinstalled the guard in late environment hooks so Rspack's option normalization could not overwrite it. | Proves hook timing for the implementation. The PR notes that its emitted-assets probe did not reproduce the supposed regression locally, so it used a direct hook test instead. |
| [`d098127d`](https://github.com/shakacode/react_on_rails_rsc/commit/d098127d899641c8e8e293a81c564dc288f0f7a9) / [PR #168](https://github.com/shakacode/react_on_rails_rsc/pull/168) | Scoped injection files and generated chunk names per compiler. | Fixes real MultiCompiler state isolation. Only the generated-name portion is coupled to the guard. |

The co-author metadata on the PR #36 commits says `Claude Opus 4.6`. That does not by itself invalidate the work, but it matters here because the unsupported Webpack/runtime explanation has the shape of a plausible post-hoc model inference. The missing sibling manifest entry is evidenced; the async-script race is not.

## Gumroad production reproduction

Gumroad first applied the same removal as a versioned `patch-package` patch in commit [`982a535d`](https://github.com/antiwork/gumroad/commit/982a535d0099ab8877dce07d8726d2d363053c5c). Its production-shaped Rspack test creates two discovered client references that share a large dependency, then verifies that:

- Rspack emits one shared sibling rather than duplicating the dependency into both boundary chunks.
- Both client-reference manifest records include that shared sibling.
- The patch changes only the published Rspack plugin and removes the guard implementation.

That patch was the concrete downstream proof for moving the correction upstream. It also surfaced the practical cost of the guard: large applications with many client boundaries could not use their normal cache groups to de-duplicate shared JavaScript.

## Why the comment is technically incorrect

### Webpack does split these chunks

The Webpack plugin creates client-reference blocks with `AsyncDependenciesBlock`, and the integration suite successfully extracts a shared JavaScript chunk from them. This command passes on current main:

```text
yarn jest tests/webpack-plugin/plugin-integration.test.ts --runInBand \
  -t "splits Button's JS into the shared chunk while its CSS stays in the sibling chunk"

PASS: 1 test
```

So self-contained generated chunks do not match a general Webpack `AsyncDependenciesBlock` invariant.

### React waits for manifest chunks

In React 19.2, [`preloadModule`](https://github.com/facebook/react/blob/v19.2.0/packages/react-server-dom-webpack/src/client/ReactFlightClientConfigBundlerWebpack.js#L194-L230) walks every manifest chunk pair, invokes the bundler chunk loader, and combines pending work with `Promise.all`. [`requireModule`](https://github.com/facebook/react/blob/v19.2.0/packages/react-server-dom-webpack/src/client/ReactFlightClientConfigBundlerWebpack.js#L232-L257) is synchronous, but it is reached after the preload dependency resolves.

Consequently, an unordered `<script async>` transport is not itself a bug. The manifest must list all sibling chunks, and the bundler's chunk loader must return promises with correct dependency semantics. That is precisely why `1c03caac` is important.

### Next.js permits shared extraction

Next.js's production [Webpack/Rspack optimization configuration](https://github.com/vercel/next.js/blob/canary/packages/next/src/build/webpack-config.ts#L1081-L1246) defines shared `framework` and `lib` cache groups with `chunks: 'all'`. Its [Flight manifest plugin](https://github.com/vercel/next.js/blob/canary/packages/next/src/build/webpack/plugins/flight-manifest-plugin.ts#L118-L149) records all files required by a client-reference chunk group. Next.js therefore follows the manifest-completeness model, not the self-contained-per-boundary model enforced by this guard.

## Guard-disabled experiment

Before removing the guard, its outer condition was temporarily changed from:

```ts
if (!this.options.isServer) {
```

to an environment-controlled condition so the same checkout could be tested with and without the behavior. The source condition was restored after the comparison, and the final implementation deletes the guard entirely.

### Results

| Test group | Guard enabled | Guard disabled | Interpretation |
| --- | --- | --- | --- |
| New `split-shared-js` asset/manifest/duplication test | Fails: shared asset is suppressed | Passes | The guard prevents valid shared extraction; without it both client-reference manifest entries list the shared sibling and the shared module sentinel is emitted once. |
| New native-default emitted-assets test (#40/#165) | Fails: shared asset is suppressed | Passes | Rspack's normalized `async` default leaves the initial dependency in `main` while extracting the dependency shared by async client references. |
| Existing `shared async dependency chunk CSS (#188)` tests | Pass | 2/2 pass | Existing group traversal handles shared sibling CSS without the guard. |
| Existing compiler-scoped injection behavior tests | Pass | 2/2 pass | MultiCompiler injection scoping is independent of the guard. |
| Five existing guard/default-selector tests | 5/5 pass | 1/5 pass | Four failures are catalogued below; none reproduces hydration failure. |
| Expanded packed Webpack + Rspack consumer pipeline | Rspack: 4 desired-behavior tests fail because no shared sibling exists | 27/27 pass | Both bundlers hydrate with the shared sibling deliberately arriving before or after boundary chunks. The negative control fails hydration only after removing that sibling from Flight metadata. |

Before the exact manifest expectation was updated, the packed pipeline's only guard-disabled failure was expected-data drift:

```text
Expected: no shared-format pair in Rspack client metadata
Received: "shared-format", "shared-format.chunk.js" in Counter,
          NestedLabel, and ThemeSection metadata

Tests: 11 passed, 1 failed
```

After adding the load-order scenarios and negative control, the complete packed suite passes 27/27 with the guard disabled. The passing tests include Flight payload generation, SSR rendering, zero-error hydration in jsdom, interaction after hydration, stylesheet behavior, a generated boundary chunk fully executed before hydration requests the shared sibling, and the inverse ordering with the shared sibling fully executed first. This is direct evidence against the claimed unavoidable sibling race under the repository's real runtime pipeline.

The negative control removes `shared-format.chunk.js` from the two directly referenced Flight import rows while leaving extraction intact. That reproduces a real runtime failure:

- Rspack logs `TypeError: __webpack_modules__[moduleId] is not a function`.
- Webpack logs `Error: Cannot find module './src/components/shared/format.js'`.
- Neither client requests `shared-format.chunk.js`, and hydration does not complete.

This matches the failure model fixed by `1c03caac`: incomplete manifest metadata, not nondeterministic sibling arrival.

### Guard-coupled tests removed or rewritten

1. `keeps splitChunks generated chunk filters scoped by compiler`
   - Directly called the wrapper and proved only that it was installed.
   - Removed; the real MultiCompiler injection-isolation tests remain.
2. `installs the default splitChunks guard before RspackOptionsApply snapshots options`
   - Asserted hook timing for the deleted implementation.
   - Replaced by a real build that observes Rspack's normalized native `async` default.
3. `preserves default async chunk selection while excluding generated client-reference chunks`
   - Mixed the useful native-default assertion with the disputed isolation behavior.
   - Replaced by separate initial-entry and shared-async dependency assertions.
4. `preserves explicit all chunk selection for non-generated chunks`
   - Expected an extracted dependency to be absent from client-reference metadata.
   - Rewritten to require the extracted dependency in the complete manifest record.

The default-optimization smoke test remains, but no longer describes self-contained chunks as a contract. Rspack's defaults simply do not extract a relevant shared dependency in that fixture.

## Proposed test plan

The goal is to preserve the real fixes from PRs #36, #40, #165, and #168 while testing the disputed guard through observable behavior rather than its implementation.

### 1. Shared JavaScript asset and manifest topology

Status: implemented and verified red/green on branch `fix/rspack-shared-client-chunks`.

- Create two `"use client"` modules that import the same `shared.js`.
- Configure a named, enforced cache group with `chunks: 'all'`, `minChunks: 2`, and `minSize: 0`.
- Assert exactly one shared JavaScript asset is emitted.
- Assert both client-reference manifest records contain their own chunk and the shared `[id, file]` pair.
- Run for both Rspack and Webpack, or use equivalent fixtures in both suites.

Expected red/green direction: fails with the current guard, passes when the guard is removed. This catches duplicated-JavaScript regressions and establishes bundler parity.

### 2. End-to-end shared sibling hydration under adversarial ordering

Status: implemented in the packed consumer pipeline for both Webpack and Rspack.

- Extend the packed consumer fixture so at least two Flight-referenced client boundaries share an extracted JavaScript chunk.
- Assert the shared asset exists and every affected manifest record lists it.
- Fully execute one generated boundary chunk before starting hydration, then repeat with the shared chunk fully executed first; in each case assert that hydration requests the remaining peer only afterward.
- Decode the Flight payload, SSR render, hydrate with the real browser runtime, and exercise both components.
- Assert zero console/recoverable errors and successful interaction.
- Run the same scenarios for Rspack and Webpack.

Expected result if the guard's comment is wrong: both bundlers pass with the guard removed because React waits for the shared chunk loader promise. If this test instead fails without the guard and passes with it, it would finally provide the missing justification and identify a concrete Rspack loader/runtime defect.

### 3. Missing-sibling negative control

Status: implemented for both bundlers; reproduces missing-module runtime failures.

- Starting from test 2, deliberately remove the shared chunk pair from one emitted manifest record in the fixture pipeline.
- Keep the shared asset extraction intact.
- Assert hydration fails with the historical missing-module/runtime error.

Expected red/green direction: fails only when manifest metadata is incomplete. This validates that the E2E would have caught the defect fixed by `1c03caac` and distinguishes it from load ordering.

### 4. PR #36 server discovery and production identity

Status: largely covered; retain and group as PR #36 regressions.

- An unreachable discovered `"use client"` module appears in both client and server manifests.
- Client/server manifest key sets match.
- Injected server modules receive real bundler module IDs rather than path fallbacks.
- Production export names remain resolvable by their Flight names.
- The injection loader creates runtime-registered async chunks.

Expected guard-disabled result: pass. These were the genuine PR #36 fixes and do not require client chunks to be self-contained.

### 5. PR #40 default selector semantics

Status: a new emitted-assets test covers the desired native-default behavior; the mixed-purpose guard test was removed.

- With `splitChunks.chunks` omitted, assert an initial-entry-only dependency is not extracted; this proves the native default is `async` rather than `all`.
- Separately use a genuinely shared async dependency and assert native extraction plus complete manifest metadata.
- With explicit `chunks: 'all'`, assert initial dependencies may be extracted and all required manifest records include them.

Expected guard-disabled result: pass. Do not assert that generated client-reference chunks are self-contained.

### 6. PR #165 options-hook timing

Status: the new native-default emitted-assets test exercises behavior after real Rspack option normalization; the direct hook test was removed with the guard.

- Replace direct assertions about `splitChunks.chunks` becoming a wrapper with an emitted-assets behavior test after Rspack default normalization.
- If no guard remains, assert the user's/default selector survives plugin application and produces the expected topology.

Expected guard-disabled result: pass. Hook-installation tests have no value once the behavior they install is removed.

### 7. PR #168 MultiCompiler isolation

Status: real MultiCompiler and loader-context isolation tests pass without the guard. The direct guard-filter test was removed.

- Build two compilers concurrently with disjoint client-reference roots and chunk names.
- Assert each manifest and injected loader source contains only its own references.
- Give each compiler a different shared dependency/cache-group name and assert neither asset/manifest leaks to the other.

Expected guard-disabled result: pass. Delete or rewrite the test that directly calls two guard wrapper functions.

### 8. Duplication and transfer-size regression

Status: the shared-JavaScript integration test asserts that a deterministic module sentinel occurs once across emitted JavaScript. A byte-budget assertion remains optional.

- Put a deterministic large shared module behind several client boundaries.
- Compare emitted JavaScript content hashes or module membership, total raw bytes, and compressed bytes.
- Assert the dependency is present once when sharing is enabled.
- Keep this as an integration budget test, not a timing benchmark.

Expected red/green direction: fails with the current guard and passes without it. This directly covers the production cost the guard imposes.

## Removal criteria

Tests 1–3 pass for Webpack and Rspack after removing the guard, the PR #36 and #168 behavior suite passes, and the packed manifest expects the shared sibling for both bundlers. If a supported Rspack version later exposes a distinct loader/runtime failure, add that concrete reproduction and use a narrowly scoped workaround instead of restoring the generic Webpack or React claims.
