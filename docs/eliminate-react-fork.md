# Eliminating the React Fork Repository

**Issue:** [#31](https://github.com/shakacode/react_on_rails_rsc/issues/31), [#55](https://github.com/shakacode/react_on_rails_rsc/issues/55) (Option 5 spike)
**Status:** Option 5 (stock npm runtime) selected — GO. The 19.2.0-rc.1 prep removes the published
vendored runtime and depends on stock `react-server-dom-webpack@^19.2.7`. The legacy
`scripts/react-upgrade/` helper remains archived for emergency maintenance of older vendored-runtime
history only. Option 4 (patch files) is the documented fallback. Fork patch history is archived in
this repo; archiving `AbanoubGhadban/react` remains an owner/admin action.
**Date:** 2026-04-17 (Options 1–4), 2026-06-12 (Option 5 spike), 2026-06-13 (patch archive)

## Background

The legacy vendored-runtime upgrade flow required two repositories:

1. **`shakacode/react_on_rails_rsc`** (this repo) — the npm package that ships built RSC artifacts in `src/react-server-dom-webpack/`, plus native code (`WebpackPlugin`, `WebpackLoader`, `RSCRspackPlugin`, etc.)
2. **`abanoubghadban/react`** — a fork of `facebook/react` hosting `rsc-patches/v<version>` branches, each containing `[RSC-PATCH]` commits on top of upstream React version tags.

The fork existed solely to park a small set of source-level patches against React's
`packages/react-server-dom-webpack/`, build the patched package, and copy the output into this repo.
It has no independent consumers. This live fork path is now legacy-only; use it only for maintainer
directed emergency maintenance while the stock-runtime replacement is still outstanding.

### Legacy upgrade flow (via `scripts/react-upgrade/`)

```
abanoubghadban/react                           shakacode/react_on_rails_rsc
┌──────────────────────────────┐               ┌──────────────────────────────┐
│ v19.0.0 (upstream tag)       │               │                              │
│ rsc-patches/v19.0.0          │  upgrade.js   │ src/react-server-dom-webpack/ │
│   ├─ [RSC-PATCH] commit A    │──────────────>│   (built output copied here) │
│   ├─ [RSC-PATCH] commit B    │  build+copy   │                              │
│   └─ [RSC-PATCH] commit C    │               │ [RSC-REPLACE] commits        │
└──────────────────────────────┘               └──────────────────────────────┘
```

### Pain points

- Two repos to maintain with disconnected histories
- Cross-repo changes require two commits and two push cycles
- Patches are invisible from this repo's PR/review flow
- CI/automation needs credentials and clone access to the fork
- The fork accumulates upstream drift and must be periodically rebased

## Options Investigated

### Option 1: Git Submodule

Embed `abanoubghadban/react` as a submodule at `vendor/react/`.

```
react-on-rails-rsc/
├── .gitmodules                     ← "vendor/react → abanoubghadban/react"
├── vendor/react/                   ← submodule (gitlinked to a specific commit)
├── src/react-server-dom-webpack/   ← built artifacts (unchanged)
└── scripts/react-upgrade/
```

**How it works:** The parent repo stores a pointer (commit SHA) to a specific commit in the submodule. Files inside the submodule are read-write. Commits made inside the submodule belong to the submodule's own git history and are pushed to the submodule's remote (`abanoubghadban/react`), not the parent's remote.

**Pros:**
- One `git clone --recurse-submodules` gets both repos
- Upgrade script works unchanged (point `--reactForkPath` to `vendor/react`)

**Cons:**
- Still two GitHub repos; commits inside the submodule push to `abanoubghadban/react`
- React's `.git` history is ~500 MB+ — every contributor pays this on `submodule update --init`
- Submodules require explicit init (`git submodule update --init`); forgotten init = empty directory
- Cross-repo changes still require two commits (one in submodule, one pointer bump in parent)
- Push ordering matters: child must be pushed before parent, or other clones break
- Submodule checkout lands in detached HEAD by default; commits without a branch can be lost

**Verdict:** Does not actually eliminate the fork repo. Marginal ergonomic improvement at the cost of significant submodule complexity.

### Option 2: Git Subtree

Import the React fork into `vendor/react/` using `git subtree add`.

```bash
git subtree add --prefix=vendor/react \
    git@github.com:abanoubghadban/react.git rsc-patches/v19.0.0 --squash
```

**How it works:** Copies the full tree of the specified branch/commit into the repo as regular files. With `--squash`, history is condensed into a single merge commit. Can push changes back upstream with `git subtree push`.

**Pros:**
- Single repo, single remote, no submodule ceremony
- Can still `subtree push` to preserve the fork if needed

**Cons:**
- Even with `--squash`, the repo balloons significantly (React's source tree is large)
- Without `--squash`: GB-scale history merged into this repo
- Every contributor clone pays the size cost permanently
- Subtree merges during upgrades are more complex than the current cherry-pick flow
- React source has no reason to live permanently in the distribution repo

**Verdict:** Too expensive in repo size. The React source tree is large and has no value to npm consumers or regular contributors.

### Option 3: On-Demand Clone (Script-Managed)

Keep the fork repo, but have `upgrade.js` automatically clone it on demand into a gitignored directory.

```
react-on-rails-rsc/
├── vendor/react/      ← .gitignored; cloned by upgrade.js on first run
└── scripts/react-upgrade/
    └── upgrade.js     ← auto-clones abanoubghadban/react if not present
```

**How it works:** The upgrade script checks if `vendor/react` exists. If not, it clones the fork. All interaction with the fork is automated and local.

**Pros:**
- Zero impact on normal contributors and CI
- Upgrade becomes a single command
- Minimal changes to existing code

**Cons:**
- Still two GitHub repos to maintain
- Patches still live in the fork, invisible from this repo

**Verdict:** A cheap ergonomic improvement worth doing regardless. Does not eliminate the fork though — just hides it better.

### Option 4: Patch Files (Superseded — Fallback Only)

Store `[RSC-PATCH]` commits as `.patch` files in this repo. Build from vanilla `facebook/react` (no fork needed).

```
react-on-rails-rsc/
├── patches/react-server-dom-webpack/
│   ├── v19.0.0/
│   │   ├── 0001-rsc-patch-add-ror-support.patch
│   │   ├── 0002-rsc-patch-fix-streaming.patch
│   │   └── 0003-rsc-patch-custom-manifest.patch
│   └── v19.1.0/
│       └── ...
├── src/react-server-dom-webpack/   ← built output (unchanged)
└── scripts/react-upgrade/
    └── upgrade.js                  ← rewritten to use git am instead of cherry-pick
```

**How it works:** The upgrade script shallow-clones vanilla `facebook/react` at the target version tag into a temporary directory, applies the `.patch` files with `git am`, builds, copies output, and discards the clone.

**Upgrade flow:**
```
facebook/react (upstream, not forked)         shakacode/react_on_rails_rsc
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ v19.2.0 tag (shallow clone)  │              │ patches/v19.2.0/             │
│   + git am 0001-*.patch      │  build+copy  │   ├─ 0001-*.patch            │
│   + git am 0002-*.patch      │─────────────>│   └─ 0002-*.patch            │
│   + git am 0003-*.patch      │              │ src/react-server-dom-webpack/ │
│   (temporary, discarded)     │              │   (built output)             │
└──────────────────────────────┘              └──────────────────────────────┘
```

**Pros:**
- One repo, one remote. `abanoubghadban/react` can be archived/deleted
- Patches are reviewable text files in normal PRs
- No submodule/subtree complexity or repo size bloat
- Builds from vanilla `facebook/react` — no fork trust chain
- CI needs no auth to a second repo
- Follows established patterns (Debian, Nixpkgs, Arch AUR all use this for patching upstream)

**Cons:**
- One-time migration cost: export existing `[RSC-PATCH]` branches to `.patch` files (trivially scriptable with `git format-patch`)
- Rebase-on-conflict UX differs slightly from cherry-pick (`git am --continue` instead of `git cherry-pick --continue`)
- Major upstream React refactors may require manual patch rebasing — but this is the same pain as today with cherry-pick conflicts

**Verdict:** Best option. Fully eliminates the fork. Patches become first-class, reviewable artifacts in this repo.

### Option 5: Stock npm Runtime (Selected — GO)

**Spike:** [#55](https://github.com/shakacode/react_on_rails_rsc/issues/55) (2026-06-12). Depend on
**stock `react-server-dom-webpack` from npm** (currently 19.2.7) instead of vendoring any custom-built
runtime. The webpack/rspack plugin and loaders are owned in-repo (#56), so the only question is whether
the *runtime* deltas in `src/react-server-dom-webpack/` still justify a custom build. This is the
Next.js model: unmodified upstream runtime + bundler plugins owned by the framework.

**Decision: GO**, gated on the #60 migration checklist below. Everything in this section was verified
against local clones/tarballs on 2026-06-12 (facebook/react clone, `abanoubghadban/react` fork
branches, and npm tarballs for 19.0.4 / 19.0.7 / 19.2.7 / 19.3.0-canary-dbc37501-20260612). Anything
not directly verified is marked UNKNOWN.

#### Premise check: stable upstream versions exist

`npm view react-server-dom-webpack versions` confirms stable lines 19.0.0–19.0.7, 19.1.0–19.1.8, and
19.2.0–19.2.7 (19.0.7 / 19.1.8 / 19.2.7 all published 2026-06-01). The canary-only constraint that
originally justified vendoring is gone.

#### Complete delta inventory: vendored runtime vs stock npm 19.0.4

The vendored build (`src/react-server-dom-webpack/`, package version 19.0.4) was diffed file-by-file
against the stock `react-server-dom-webpack@19.0.4` npm tarball. The *entire* real delta is:

| # | Delta | Where | Status upstream |
|---|-------|-------|-----------------|
| 1 | JSON-walk parsing perf patch (`parseModel`/`reviveModel` instead of `JSON.parse` reviver) | All `cjs/*client*` builds (~97 changed lines each); landed via [#33](https://github.com/shakacode/react_on_rails_rsc/pull/33) | **Upstreamed**: [facebook/react#35776](https://github.com/facebook/react/pull/35776), commit `f247ebaf44317ac6648b62f99ceaed1e4fc4dc01` (2026-02-19). **Not** in 19.2.7 (verified: 19.2.7 client still uses `JSON.parse(model, response._fromJSON)`); **is** in 19.3 canaries (verified in `19.3.0-canary-dbc37501-20260612`) → ships in 19.3 stable. |
| 2 | FOUC fix: `emitClientReferenceCSS`/`resolveClientReferenceCSS` emit Flight `"S"` stylesheet hints (`rsc-css` precedence) per client reference with manifest `css` entries | All `cjs/*server*` builds (~24 lines each); current form is the **in-repo rewrite** (commits `dc4dfb4`, `867634f`, `8781f08`, PR [#49](https://github.com/shakacode/react_on_rails_rsc/pull/49)) — it no longer matches the fork branch (`fix/3211-rsc-css-deferred-suspense` @ `980eda222` still has the older loader-wrapper + `globalThis` approach that #48/#49 dropped for cross-request races and prop-shape changes) | **Not upstream** anywhere: no markers in 19.2.7, 19.3 canary, or `facebook/react` main source (grepped `packages/react-server*`). |
| 3 | `loadServerReference` bound-args check: vendored keeps `null !== metaData`, stock uses `metaData instanceof Promise` (deliberate divergence, PR [#48](https://github.com/shakacode/react_on_rails_rsc/pull/48) "preserve bound server action decoding for React thenables") | `cjs/*server*` builds (1 line) | Upstream (19.0.4 → main) uses `instanceof Promise`. Low risk: `ReactPromise` chains `Object.create(Promise.prototype)` in all three builds compared, so Flight thenables pass `instanceof Promise`. Verify bound server actions in the #60 smoke test. |
| 4 | `[RSC-REPLACE]` branding: `rendererPackageName: "react-on-rails-rsc"` (dev builds), `index.js` error text, `node-register` require path | Cosmetic | n/a — dropped with the vendored runtime; devtools will report `react-server-dom-webpack`. |
| 5 | The 5 webpack-plugin patches (`plugin.js`, `esm/` node loader) | Build tooling, not runtime | Moot once #56 (in-repo plugin/loader extraction) lands. |

There are **no other** runtime deltas — every changed line in the client builds belongs to #1/#4 and
every changed line in the server builds belongs to #2/#3/#4.

#### Security: vendoring is currently *behind* stock npm

The vendored 19.0.4-based runtime predates the 2026 DoS fixes and sits inside the published vulnerable
ranges of:

- **CVE-2026-23869** (DoS, patched in 19.0.5 / 19.1.6 / 19.2.5, published 2026-04-08 —
  [GHSA-479c-33wc-g2pg](https://github.com/facebook/react/security/advisories/GHSA-479c-33wc-g2pg))
- **CVE-2026-23870** (DoS, patched in 19.0.6 / 19.1.7 / 19.2.6, published 2026-05-06 —
  [GHSA-rv78-f8rc-xrxh](https://github.com/facebook/react/security/advisories/GHSA-rv78-f8rc-xrxh))

Verified by marker grep: the reply-decode hardening present in stock 19.0.7 (`_formData.data.get`
wrapping, "initialized stream chunk" guard) is absent from the vendored server builds. Stock npm
turns every future React security release into a version bump instead of a fork rebuild — this is the
strongest single argument for GO. (Flagged to the maintainer in the #55 spike report for remediation
independently of #60 — either an interim vendored rebuild at the 19.0.7 security level or an expedited
#60 migration.)

#### FOUC fix without patching React (feasible)

The current FOUC mechanism is server-side only, and the client half is already stock behavior:

- Stock 19.2.7 **client** natively consumes `"S"` hints (`case "S"` → `preinitStyle`), so no client
  change is needed.
- Stock 19.2.7 **server** exposes the exact emission primitive the patch uses: `preinitStyle(href,
  precedence, options)` resolves the current request via `resolveRequest()` (request-scoped through
  `currentRequest`/AsyncLocalStorage) and calls `emitHint(request, "S", [href, precedence])` with the
  same `"S|" + href` dedupe key as the vendored `emitClientReferenceCSS`. Calling
  `ReactDOM.preinit(href, { as: 'style', precedence: 'rsc-css' })` during a Flight render therefore
  produces wire-identical hints.

Proposed wrapper-layer design (to prototype in #60): `src/server.node.ts` already owns the
`filePathToModuleMetadata` object it passes to `renderToPipeableStream` as the `webpackMap`. Wrap it in
a `Proxy` whose property getter — invoked by the stock runtime's client-reference metadata lookup
(`config[modulePath]`, with `#`-suffix fallback) during serialization, i.e. inside the active request —
calls `ReactDOM.preinit(...)` for each `css` entry of the resolved module before returning the
metadata. This is request-scoped, preserves client-reference prop shapes (unlike the abandoned
loader-wrapper approach from PR #35), and needs zero React changes. Duplicate `preinit` calls for the
same href (e.g. the same client module referenced from two Suspense boundaries) are idempotent:
`emitHint` deduplicates on the `"S|" + href` key. The existing
`tests/react-flight-client-reference-css.rsc.test.ts` suite must pass against the new implementation.

If the proxy prototype fails (e.g. lookup happens outside the request context, or hint ordering
regresses the `$RR` gating), fall back to Option 4 below.

#### JSON-walk perf patch: accept temporary loss until 19.3

Upstream's benchmark ([facebook/react#35776](https://github.com/facebook/react/pull/35776)) reports
~72–78% faster chunk deserialization. A local micro-benchmark replicating the structural difference
(reviver vs walk on Flight-shaped payloads, Node v24.8.0, 2026-06-12) reproduces it. Methodology, for
re-running after a React bump: synthetic Flight-shaped JSON (`["$","tag",key,{props}]` element trees
with `$`-prefixed reference strings, 10/100/1000 rows), 50 warmup iterations, then 2000 timed
iterations (300 for the 1000-row payload) of (a) `JSON.parse` with a reviver that short-circuits
non-`$` strings vs (b) bare `JSON.parse` followed by a recursive `reviveModel` walk — mirroring
`initializeModelChunk` in stock 19.2.7 vs upstream `f247ebaf4` respectively:

| Payload | Reviver (stock 19.2.7) | Walk (vendored / 19.3) | Speedup |
|---------|------------------------|------------------------|---------|
| 1.9 KB | 0.053 ms | 0.008 ms | 85% |
| 18.8 KB | 0.495 ms | 0.078 ms | 84% |
| 191.7 KB | 4.761 ms | 0.772 ms | 84% |

Absolute cost of accepting stock 19.2.7 parsing: under ~5 ms per ~200 KB payload parse (cost scales
roughly linearly with payload size — extrapolating, ~47 ms reviver vs ~8 ms walk at 2 MB). This is
acceptable as a temporary regression because the patch is already on upstream `main` and in 19.3
canaries; it returns automatically with the 19.3 stable bump. If a downstream app proves this
unacceptable before 19.3, that triggers the Option 4 fallback instead.

#### Exports/conditions parity (11 export paths)

| `react-on-rails-rsc` export | Backing today | Backing with stock npm | Parity |
|---|---|---|---|
| `./client` (node) | wrapper → vendored `client.node` | wrapper → `react-server-dom-webpack/client.node` | ✓ `createFromNodeStream(stream, {moduleMap, serverModuleMap, moduleLoading}, options)` byte-identical resolution logic |
| `./client` (browser/default), `./client.browser` | wrapper → vendored `client.browser` | wrapper → `react-server-dom-webpack/client.browser` | ✓ 19.2.7 exports a superset (`createFromFetch`, `createFromReadableStream`, `createServerReference`, `createTemporaryReferenceSet`, `encodeReply` + new `registerServerReference`) |
| `./client.node` | wrapper → vendored `client.node` | wrapper → stock `client.node` | ✓ |
| `./server.node` | wrapper → vendored `server.node` | wrapper → stock `server.node` + wrapper-layer FOUC hints | ✓ `renderToPipeableStream(model, webpackMap, options)` unchanged; 19.2.7 adds `prerender`, `prerenderToNodeStream`, `renderToReadableStream`, `decodeReplyFromAsyncIterable` |
| `./server` (conditional map) | re-exposes vendored condition map incl. `react-server`, `workerd`, `deno`, `edge-light`, `browser`, node `webpack`/`default` split | per-condition re-export shims of `react-server-dom-webpack/server.*` | ✓ with one caveat: stock ≥19.2.4 **removed the `*.unbundled` variants** and the node `webpack`/`default` split (upstream `378973b387b6a6f287e451dd0356099180684c3c`, [facebook/react#35290](https://github.com/facebook/react/pull/35290), 2025-12-05 — moved to private `react-server-dom-unbundled`). See below. |
| `./WebpackPlugin`, `./WebpackLoader`, `./RSCReferenceDiscoveryPlugin`, `./RspackPlugin`, `./RspackLoader` | in-repo TS (loader currently delegates to vendored `esm/` transform) | in-repo TS only (#56) | ✓ no stock-runtime dependency; loader-emitted code imports `react-on-rails-rsc/server` (`registerClientReference`/`registerServerReference`), which the re-export shims provide |
| `.` (types) | in-repo `dist/types` | unchanged | ✓ |

**Unbundled caveat:** before the 19.2 runtime migration, a plain-Node (no `webpack` resolve condition)
`require('react-on-rails-rsc/server')` resolved to `server.node.unbundled.js` (module loading via
`import(specifier)`). Stock ≥19.2.4 removed that public runtime, so the 19.2 package line keeps a
separate plain-Node shim for `react-on-rails-rsc/server`: registration and render helpers remain
available, but server-action decode APIs fail with an explicit migration error instead of falling into
the webpack-flavored `__webpack_require__` path. Webpack-bundled consumers are unaffected (webpack sets
the `webpack` condition, and the loader-emitted imports are resolved at bundle time). Note
`registerClientReference`/`registerServerReference` themselves do not touch webpack globals, so plain
registration keeps working.

#### Webpack globals contract and SSR manifest formats (unchanged)

Diffed vendored (~19.0.4) vs stock 19.2.7 built files:

- `client.node`: identical call sites — `__webpack_require__(id)`, `__webpack_chunk_load__(chunkId)`,
  `__webpack_require__(metadata[0])`.
- `server.node`: identical — `__webpack_require__` only in server-reference (server action)
  preload/require.
- `resolveClientReference` (SSR consumer-manifest lookup) is **byte-identical** between stock 19.0.4
  and stock 19.2.7, and matches the vendored build.
- Client-manifest lookup on the server (`config[$$id]`, `#`-suffix fallback, `{id, chunks, name,
  async}` entry shape) unchanged.
- Import metadata wire format (`[id, chunks, name, async?]`) unchanged.

`src/client.node.ts` (`createSSRManifest`: `{moduleLoading, moduleMap}`) and `src/server.node.ts`
(passes `filePathToModuleMetadata` as the webpackMap) need no contract changes.

#### Migration checklist for #60

1. Add `react-server-dom-webpack@^19.2.7` as a dependency; delete `src/react-server-dom-webpack/`
   (after #56 has moved the plugin/loader in-repo and `WebpackLoader.ts` no longer imports the vendored
   `esm/` transform).
2. Repoint wrapper imports (`src/client.browser.ts`, `src/client.node.ts`, `src/server.node.ts`) from
   `./react-server-dom-webpack/*` to `react-server-dom-webpack/*` (stock conditional exports cover
   every entry used).
3. Re-implement the FOUC stylesheet hints in the wrapper layer (manifest-`Proxy` + `ReactDOM.preinit`
   design above); keep `tests/react-flight-client-reference-css.rsc.test.ts` green. **Gate: if the
   prototype fails, stop and take the Option 4 fallback.**
4. Replace the `./server` export map with per-condition re-export shims of
   `react-server-dom-webpack/server.*`; preserve a distinct plain-Node branch that fails explicitly
   for removed unbundled server-action decode APIs. **Gate: if any downstream consumer is found that
   requires the removed unbundled semantics and cannot migrate, stop and take the Option 4 fallback.**
5. Bump `react`/`react-dom` peerDependencies to `^19.2.7` (stock 19.2.7 peers on `^19.2.7`).
   Consumer-visible: apps must be on React ≥19.2.7 — a breaking change for consumers on React
   19.0.x/19.1.x. Version the release accordingly: this package's version tracks the bundled runtime
   line (currently 19.0.5-rc.x), so the migration release should move to the 19.2.x line, which both
   signals the new React floor and satisfies semver for the dropped peer range. Changelog entry
   required.
6. Verify bound-server-action decoding (delta #3) and run the full suite (`yarn build` + `yarn test`)
   plus a downstream smoke test (react_on_rails / pro dummy app: hydration, server actions,
   deferred-Suspense CSS on slow network).
7. Confirm devtools/`rendererPackageName` reporting change (`react-server-dom-webpack` instead of
   `react-on-rails-rsc`) is acceptable; update any docs/tests that assert the branding.
8. On React 19.3 stable: bump and confirm the JSON-walk perf patch is included (re-run the parse
   benchmark if desired).
9. Archive `abanoubghadban/react` and delete or replace `scripts/react-upgrade/` fork tooling.
   **Prerequisite:** all Option 4 fallback criteria (below) have been ruled out, the step 6 smoke
   test is green, the fork branch history is preserved in `patches/archive/`, and an owner/admin
   archives the fork. Archiving keeps the repo readable on GitHub but treat this as the point of no
   return for the cherry-pick workflow.

#### Fallback criteria (Option 4, 2-patch corpus)

Take the Option 4 patch-file rebuild — with a corpus of at most **2 runtime patches** (FOUC fix;
JSON-walk only until 19.3) applied to vanilla `facebook/react` — if **any** of these hold:

- The wrapper-layer FOUC prototype (checklist step 3) cannot reproduce the `$RR` gated-swap behavior
  (hints missing, mis-ordered, or not request-scoped) and the existing CSS test suite cannot be made
  to pass without patching React.
- A downstream app demonstrates that stock 19.2.7 reviver parsing is an unacceptable regression
  before React 19.3 stable ships.
- The unbundled `./server` verification (checklist step 4) finds a real consumer that requires the
  removed `*.unbundled` runtime semantics that cannot be migrated to the webpack-flavored build.
- Upstream stable falls back behind on a security fix we need faster than a release cycle (unlikely —
  the current situation is the reverse).

Option 4 remains fully specified below (Decision section history). The fork branch history is now
preserved under `patches/archive/`; do not use the live fork as the normal patch source.

#### Upstream patch and fork-retirement status

Status verified 2026-06-13 for
[#58](https://github.com/shakacode/react_on_rails_rsc/issues/58) and
[#71](https://github.com/shakacode/react_on_rails_rsc/issues/71):

- Patch history is preserved in
  [`patches/archive/abanoubghadban-react/`](../patches/archive/abanoubghadban-react/).
  This archive includes the three `rsc-patches/v*` branches plus the two
  upstream-shaped runtime topic branches. It is historical evidence, not the
  active fallback patch directory.
- JSON-walk parsing is already upstreamed in
  [facebook/react#35776](https://github.com/facebook/react/pull/35776),
  merge commit `f247ebaf44317ac6648b62f99ceaed1e4fc4dc01`; no new upstream PR
  is needed for that patch.
- The FOUC topic branch
  `fix/3211-rsc-css-deferred-suspense` (`980eda222`) is not upstream in
  `facebook/react` main or `v19.2.7`, but that exact patch shape is obsolete for
  this repo: it uses the older loader-wrapper/global-manifest approach that #48
  and #49 replaced with request-scoped stylesheet hints. If the wrapper-layer
  stock-runtime design fails, upstream or fallback work should be based on the
  current hint-emission design, not the archived topic patch.
- The `loadServerReference` bound-args divergence is a stock-runtime smoke-test
  gate, not an upstream patch request.
- `AbanoubGhadban/react` is still public and unarchived. The current token has
  pull-only permission (`admin=false`, `push=false`), so archiving the fork is
  blocked on owner/admin action.

## Decision

**Superseded 2026-06-12 by Option 5 (stock npm runtime) — see above; GO, gated on the
stock-runtime checklist, with Option 4 as the explicit fallback.**

Original decision (2026-04-17): **We are going with Option 4 (patch files).**

## Implementation Plan (Option 4 — now the fallback path)

The steps below implement Option 4 and apply **only if** an Option 5 fallback criterion (above) is
triggered. The active migration plan is the #60 checklist in the Option 5 section.

Original note: implementation will begin in a follow-up issue after the currently open PRs are merged (#29, #21, #20, #11).
The historical fork patch corpus has since been archived under
`patches/archive/abanoubghadban-react/`; use that archive as the provenance source for any fallback
patch-file work.

High-level steps:

1. **Seed active fallback patches from the archive** — Start from the preserved
   `patches/archive/abanoubghadban-react/` history and create the minimal active corpus under
   `patches/react-server-dom-webpack/v<version>/`. Do not depend on the live fork for normal fallback
   work.

2. **Rewrite `scripts/react-upgrade/upgrade.js`** — Replace the cherry-pick workflow with:
   - Shallow-clone `facebook/react` at the target tag into a temp directory
   - `git am` the patch files from `patches/react-server-dom-webpack/v<version>/`
   - Build and copy (existing `buildAndCopy` logic, unchanged)
   - Clean up temp clone

3. **Update patch management tooling** — Add helper scripts for:
   - Creating a new patch version directory from an existing one
   - Rebasing patches against a new upstream tag
   - Validating that patches apply cleanly (CI check)

4. **Update CI** — Remove any references to `abanoubghadban/react`. Add a CI job to validate patches apply cleanly against their target React version.

5. **Archive `abanoubghadban/react`** — Once everything is verified, have an owner/admin archive or
   delete the fork.
