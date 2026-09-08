# RSCWebpackPlugin — Known Problems and Limitations

> **Internal document — ShakaCode.** Not for public distribution.
>
> Companion to [css-to-component-association-approaches.md](css-to-component-association-approaches.md).
> Covers problems observed in the current `RSCWebpackPlugin` CSS and JS manifest
> logic as of 19.2.0-rc.3 (commit 047713d).

## 1. Transitive CSS through JS intermediaries can be missed

The sibling-chunk CSS recovery pass (#113) follows only **direct** style imports
from a client reference module — one level deep via
`moduleGraph.getOutgoingConnections()`. This is intentional (prevents
reintroducing broadcast), but it means CSS imported through a JS intermediary
that gets split into a different chunk can be missed.

**Example:**

```
ButtonGroup.tsx  ("use client")
  → imports button-utils.ts
      → imports button-group-layout.css
```

If `SplitChunksPlugin` moves `button-utils.ts` and `button-group-layout.css`
into a separate chunk from `ButtonGroup.tsx`:

- Per-chunk pass: `ButtonGroup.tsx` is in chunk A, `button-group-layout.css` is
  in chunk B. Chunk A has no CSS. Chunk B has no client reference.
- Sibling recovery: walks `ButtonGroup.tsx` direct imports — finds
  `button-utils.ts` (JS, not CSS) and stops. Never reaches
  `button-group-layout.css`.
- Result: `ButtonGroup` manifest entry has `css: []`, its styles are lost.

**Why Waku doesn't have this:** Waku walks the module graph recursively — JS
intermediaries are traversed, not treated as dead ends. The walk collects every
CSS leaf regardless of depth.

**Mitigation:** In practice, `MiniCssExtractPlugin` usually extracts CSS into
the same chunk as the JS module that imported it, so the per-chunk pass catches
it. The gap only appears when `SplitChunksPlugin` specifically separates the JS
intermediary (and its CSS) from the client reference's chunk. This is uncommon
but possible with aggressive cache group configs.

## 2. CSS discovery is chunk-driven, not module-driven

The plugin's primary CSS pass iterates `chunk.files` looking for `.css` files,
then associates them with every client reference module found in that chunk. This
is an inverted approach — it asks "what CSS lives in this chunk?" rather than
"what CSS does this component need?"

**Consequences:**

- Two unrelated client references in the same chunk get the same CSS list, even
  if only one of them imports styles.
- A client reference that imports no CSS but happens to share a chunk with
  another component's extracted CSS will receive that CSS in its manifest entry.
- The approach required three separate commits (#51, #108, #113) to reach
  correctness — each fixing an edge case the chunk-level view couldn't naturally
  handle.

**A module-graph-driven approach** (walking from each client reference through
its imports, collecting CSS leaves, then looking up which output file each CSS
module landed in) would eliminate these edge cases by construction. The tradeoff
is deeper coupling to `MiniCssExtractPlugin` internals (`css/mini-extract` module
type, the authored-resource → extracted-file mapping).

## 3. No server component CSS tracking

The plugin only tracks CSS for **client** references (`"use client"` modules).
Server components that import CSS are invisible to the manifest.

In React's streaming SSR model, server component CSS matters: if a server
component imports `layout.css`, that CSS needs to reach the HTML response. Today,
this is handled by the host app's entry chunk or by the app's own asset pipeline
— the RSC plugin contributes nothing.

Waku tracks both via separate manifest buckets:
- `serverResources`: server component CSS, injected as `<link>` React elements in
  the RSC stream
- `clientReferenceDeps`: client component CSS, injected via `ReactDOM.preinit()`

Adding server component CSS tracking to the webpack plugin would require knowing
which server components rendered — something the plugin can't determine at build
time since server components run outside webpack.

## 4. Client-side navigation FOUC risk

The plugin injects CSS via `preinit(href, { as: 'style', precedence: 'rsc-css' })`
in `flight-stylesheet-hints.ts`. This works well for SSR:

- Fizz emits `<link>` in `<head>` → browser natively blocks first paint.
- Late-streamed boundaries use `completeBoundaryWithStyles` → blocks DOM swap
  until CSS loads.

But during **client-side navigation** (no full page reload), `preinit` inserts a
`<link>` element via `document.createElement` + `appendChild`. Script-inserted
stylesheets are **not** render-blocking per browser spec. And `preinit` creates
**no React Suspense dependency** — React commits the DOM immediately regardless
of whether the CSS has loaded.

Only `<link rel="stylesheet" precedence="..." />` **rendered as a React element
in component JSX** triggers React's commit-phase suspension (PR #26398). The
plugin uses `preinit` (imperative), not JSX rendering (declarative), so there is
no commit-phase blocking.

**Practical impact:** On client-side navigation to a route with new client
components, there is a window where content is visible but unstyled. The severity
depends on CSS file size and network speed. On fast connections it is usually
imperceptible; on slow connections it can be visible.

**What a fix would look like:** Instead of calling `preinit()` from a Proxy
getter, the server renderer would need to emit `<link precedence="...">` as
React elements in the RSC stream alongside client references. This is what
Waku does for server component CSS (but not for client component CSS — Waku has
the same limitation there).

## 5. `ConcatenationModule` drops child-module CSS hinting

When webpack's `ModuleConcatenationPlugin` folds multiple modules into a single
`ConcatenationModule`, the plugin iterates `module.modules` (the inner modules)
to find client references and run `recordModule` on them:

```typescript
if (module.modules) {
  for (const concatenatedMod of module.modules) {
    recordModule(moduleId, concatenatedMod, moduleCss);
  }
}
```

However, the sibling CSS recovery pass (`addDirectCssDepFiles`) runs on the
**outer** `ConcatenationModule` and also iterates `module.modules`, but only
walks outgoing connections from each inner module. If the concatenated module
has complex internal dependency edges (inner module A imports inner module B
which imports CSS), those internal edges may not surface through
`getOutgoingConnections` on module A.

### Measured: this *does* drop CSS hints (issue #224)

The paragraph that used to close this section claimed the interaction was
"unlikely to cause real issues because client references are async boundaries."
That reasoning is correct about the client reference itself and still wrong
about the outcome. Scope hoisting does not fold the reference, but it does hide
the module edge the sibling-CSS walk follows to reach a child's stylesheet.

Measured on `35d52af` (`main` with #222), reading each reference's `css` array
from the emitted manifest:

| Fixture / topology | `concatenateModules` | `cssWrapper` | CSS hinted? |
| --- | --- | --- | --- |
| `split-shared-css` — child shared by two refs | `false` | `false` | yes |
| `split-shared-css` | `false` | `true` | yes (since #222) |
| `split-shared-css` | `true`  | `false` | **no** |
| `split-shared-css` | `true`  | `true`  | **no** |
| `transitive-css-only-chunk` — child of a *single* ref | `false` | `false` | yes |
| `transitive-css-only-chunk` | `true` | `false` | **no — `css` is `[]`** |

Two things to take from the table:

1. **It is not limited to shared children.** A single client reference whose
   child module imports CSS loses that stylesheet too, and in the CSS-only
   split-chunk topology the reference's `css` array comes back **empty** — the
   stylesheet is emitted as `styles.chunk.css` and nothing points at it.
2. **It is independent of `cssWrapper`.** #222 fixed the `cssWrapper` variant of
   the *non-hoisted* walk (row 2), but every hoisted row stays broken with the
   option off as well as on.

In all rows the stylesheet asset is emitted and the owning chunk is present in
the reference's `chunks`; only the hint is missing. So the failure is a manifest
under-report, not a chunking difference.

`optimization.concatenateModules` is **enabled by default in webpack
`mode: 'production'`**, so the #188/#190 shared-child CSS recovery shipped in
19.2.1 — and the transitive-child recovery alongside it — are inert in a default
production build.

**Why the suite never caught it:** `tests/webpack-plugin/helpers/runWebpackWithPlugin.js`
pins `mode: 'development'`, where `concatenateModules` defaults to `false`. The
webpack plugin suite has never exercised production defaults.

**Status:** tracked in issue #224, shipping as a known limitation in `19.3.0`.
It is pre-existing (19.2.1), not a regression from the 19.3.0 line, and the fix
touches the `cssWrapper: false` path that #222 is specifically demonstrated to
leave alone — so it needs its own PR and review cycle.

## 6. Per-chunk-group JS means over-preloading

JS chunks are collected **group-wide**: every client reference in a chunk group
gets every JS chunk from that group. If chunk group X contains 5 chunks but
client reference A only needs code from 2 of them, A's manifest still lists all
5. The browser preloads and evaluates all of them.

This is correct for execution (all chunks must load before any module runs), but
it means rendering a single client component can trigger loading JS for sibling
components in the same chunk group that are never rendered on this page.

**How Waku differs:** Waku uses `clientChunks: (meta) => meta.serverChunk` to
group client references by the server chunk that imports them. All client refs
imported by the same server component land in one client chunk. This is coarser
(one chunk per server component, not per client component) but more predictable
— no sibling over-preloading because the chunk contains exactly what that server
component needs.

## 7. `publicPath: 'auto'` disables CSS recording

```typescript
let cssPrefix =
  typeof compilation.outputOptions.publicPath === 'string' &&
  compilation.outputOptions.publicPath !== 'auto'
    ? compilation.outputOptions.publicPath
    : null;
```

When `publicPath` is `'auto'` (webpack's default), `cssPrefix` becomes `null`,
and `isRecordableCss` returns `false` for all CSS files. Every client reference
gets `css: []`. This is silent — no warning is emitted.

This is a deliberate design choice (the plugin can't know the runtime public path
at build time), but it means any project using `publicPath: 'auto'` gets no CSS
hints at all. The failure mode is invisible: styles appear to work because the
page entry still loads them, but the RSC stream emits no `preinit` hints, so
streaming Suspense boundary reveals have no CSS gating.

## 8. Eagerly-imported client references get a nondeterministic chunk group

When webpack inlines an async boundary (client reference imported eagerly by an
entry), the `AsyncDependenciesBlock`'s chunk group has no chunks containing that
module. The fallback pass scans `chunkGroupsWithBlocks` in iteration order:

```typescript
for (let i = 0; i < chunkGroupsWithBlocks.length && unrecordedClientFiles.size > 0; i++) {
  recordChunkGroup(chunkGroupsWithBlocks[i]!, unrecordedClientFiles);
```

The first chunk group containing the module wins. If the module appears in
multiple chunk groups, which one gets chosen depends on `compilation.chunkGroups`
iteration order — which is not guaranteed to be stable across builds with
different entry configurations.

**Practical impact:** The manifest entry for eagerly-imported client references
can list different sets of JS/CSS chunks in different builds, even with the same
source code, depending on entry order. This doesn't cause runtime failures (the
chunks are all loaded), but it can cause unnecessary preloads and makes build
output nondeterministic.

## Summary

| # | Problem | Severity | Exploitable by users? |
|---|---------|----------|----------------------|
| 1 | Transitive JS→CSS missed after split | Low | Only with aggressive `splitChunks` configs |
| 2 | Chunk-driven CSS (not module-driven) | Design | Causes complexity; no direct user bug |
| 3 | No server component CSS | Medium | Server-imported CSS relies on host app |
| 4 | Client-nav FOUC via `preinit` | Low-Medium | Visible on slow networks during SPA nav |
| 5 | `ConcatenationModule` drops child-module CSS hints | **Medium** | **Yes — webpack `mode: 'production'` default; see #224** |
| 6 | JS over-preloading per chunk group | Low | Extra bandwidth, no missing functionality |
| 7 | `publicPath: 'auto'` silently drops CSS | Medium | Silent degradation, no warning |
| 8 | Nondeterministic eager-import fallback | Very low | Extra preloads, no missing functionality |
