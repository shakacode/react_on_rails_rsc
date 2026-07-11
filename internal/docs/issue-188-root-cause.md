# Issue #188 — Root Cause, Explained From Zero

**Issue:** [shakacode/react_on_rails_rsc#188](https://github.com/shakacode/react_on_rails_rsc/issues/188)
— *RSC: shared client-reference child CSS dropped from manifest → FOUC
(`chunkGroupUseCount===1` over-excludes)*

This document explains the bug assuming no prior knowledge of webpack, webpack
plugins, or Shakapacker. It builds up every concept the bug depends on, then
walks through the failure line by line, then explains the history of how the
code got this way and why the fix is what it is.

Everything below was verified empirically against `main` at `b5f2034` — the
chunk tables and manifest excerpts are real output from instrumented builds of
this repo's own test fixture, not hypotheticals.

---

## 1. The one-paragraph version

When two client components both import the same plain helper component, the
bundler is smart enough to store that helper (and its CSS file) **once**, in a
"shared" file, instead of copying it into both components' files. But this
package's manifest-building code has a rule that refuses to credit any shared
file's CSS to any component — the rule was written to prevent a different bug
and uses "is this file shared?" as a stand-in for "is this CSS already on the
page?". Those are not the same question. The result: the shared CSS belongs to
*nobody*, no early-load hint is ever emitted for it, and the browser only
fetches it late, as a side effect of running JavaScript. The helper component
visibly renders unstyled first and then "pops" into its styles — a Flash Of
Unstyled Content (FOUC).

---

## 2. Background: the players

### 2.1 React Server Components and "client components"

React Server Components (RSC) split a React app into two worlds:

- **Server components** render only on the server. Their output is sent to the
  browser as data (the *Flight payload*, also called the RSC payload), never as
  JavaScript.
- **Client components** are ordinary interactive React components. A file
  becomes a client component by starting with the directive `'use client'`.

When a server component renders `<Widget />` and `Widget` is a client
component, the server cannot inline it. Instead it writes a **client
reference** into the Flight payload — essentially a note that says:

> "At this position in the tree there is a client component. Its code lives in
> module X. Browser: go load module X and render it yourself."

For the browser to act on that note, something must translate "module X" into
concrete URLs: *which JavaScript files must be loaded, and which CSS files does
this component need?* That translation table is the **client manifest** — a
JSON file this package generates at build time. One entry per client component:

```jsonc
// react-client-manifest.json (abridged)
{
  "filePathToModuleMetadata": {
    "file:///app/components/Widget.jsx": {
      "id": "./components/Widget.jsx",
      "chunks": ["client-Widget", "/assets/client-Widget.chunk.js"],
      "css":    ["/assets/client-Widget.chunk.css"]
    }
  }
}
```

The `css` array is the heart of this bug. Keep an eye on it.

### 2.2 Why the `css` array exists: paint-blocking stylesheet hints

CSS referenced by JavaScript has a delivery problem. If a stylesheet is only
fetched when the JavaScript that imports it finally runs, the component's HTML
(server-rendered, so it arrives immediately) is on screen **before** its
styles. The user sees raw unstyled markup, then the styles snap in. That flash
is FOUC.

To prevent it, the Flight server in this package emits a **stylesheet hint**
for every CSS file listed in a rendered component's manifest entry. The
mechanics (all verifiable in this repo):

1. `renderToPipeableStream(model, webpackMap, ...)` wraps the manifest in a
   JavaScript `Proxy` (`src/flight-server.node.ts:42` →
   `withStylesheetHints`, `src/flight-stylesheet-hints.ts`).
2. Every time Flight serializes a client reference, it reads that component's
   manifest entry through the Proxy. The Proxy's `get` trap fires
   `preinit(href, { as: 'style', precedence: 'rsc-css' })` for each URL in the
   entry's `css` array.
3. Inside a Flight render, `preinit` is recorded and serialized into the
   payload as a hint row — the `:HS` lines visible in a raw RSC payload:

   ```
   :HS["/assets/client-Widget.chunk.css","rsc-css"]
   ```

4. During server-side HTML rendering, that hint becomes a real
   `<link rel="stylesheet" precedence="rsc-css">` in the document head — the
   stylesheet is fetched **before first paint**, render-blocking, so the
   component appears styled from the very first frame. On the client, React
   deduplicates these by URL, so the same CSS hinted twice costs nothing.

The chain to remember:

```
manifest css[] ──▶ preinit() ──▶ :HS hint in payload ──▶ <link> before paint ──▶ no FOUC
```

**If a CSS file never makes it into any component's `css[]`, no hint is ever
emitted for it.** Then its only remaining delivery path is step zero of the
old, slow way: some JavaScript chunk loads at hydration time and inserts the
stylesheet itself. HTML paints first; styles arrive later; FOUC.

### 2.3 Webpack in five minutes

[webpack](https://webpack.js.org/) is the bundler: it takes your source files
and produces the actual files a browser downloads. The concepts the bug lives
in:

- **Module** — one source file (`Widget.jsx`, `Card.css`, …). In webpack's
  world, a CSS file imported from JavaScript (`import './Card.css'`) is a
  module too.
- **Entrypoint** — a named starting file listed in the config. Webpack follows
  every `import` from there to discover the full graph. A Rails/Shakapacker app
  typically has one entrypoint per "pack" (e.g. `application`).
- **Chunk** — one output file group. Webpack assigns every module to one or
  more chunks; each chunk becomes real emitted files (a `.js` file, and — see
  below — possibly a `.css` file).
- **Initial vs. async chunks** — chunks that load with the entrypoint itself
  via `<script>`/`<link>` tags in the HTML are **initial**. Chunks created for
  `import('...')` (dynamic import — "load this code later, on demand") are
  **async**: they are fetched by webpack's runtime *when the code path runs*,
  not by the HTML. This distinction is the crux of the whole bug, so it gets
  its own section (§2.5).
- **Chunk group** — each entrypoint, and each dynamic `import()` site, gets a
  *group* of chunks: "to satisfy this load, fetch all of these chunks."
  A chunk can belong to **many** groups — that is exactly what sharing means.
- **SplitChunks** — a webpack optimization (configured under
  `optimization.splitChunks`) that moves modules used by several chunks into a
  new shared chunk, so the browser downloads them once instead of N times. A
  `cacheGroup` is one named rule telling SplitChunks what to extract (e.g.
  "everything from node_modules goes into a `vendor` chunk").
- **mini-css-extract-plugin** — by default, webpack would leave CSS inside
  JavaScript strings. This plugin *extracts* it: each chunk's CSS modules
  become a real `.css` file alongside the chunk's `.js` file. That is where
  files like `client-Widget.chunk.css` come from.

### 2.4 Shakapacker's role (small but relevant)

[Shakapacker](https://github.com/shakacode/shakapacker) is the Rails-webpack
bridge. In a Rails view, `javascript_pack_tag "application"` and
`stylesheet_pack_tag "application"` emit `<script>`/`<link>` tags for the
**initial** chunks of the `application` entrypoint.

That gives initial chunks a guaranteed CSS delivery path that async chunks do
not have: *if a CSS file belongs to an initial chunk, the page's own HTML
already loads it, render-blocking, on every request.* Nothing extra needed.
An async chunk's CSS has **no** such path — the only ways it ever reaches the
browser are (a) an `rsc-css` hint from the manifest, or (b) as a late side
effect of JavaScript chunk loading. This asymmetry is why "initial vs. async"
is the correct question for the bug — and why the code's actual question
("shared vs. private") was the wrong one.

### 2.5 How this package's webpack plugin builds the manifest

`RSCWebpackPlugin` (`src/webpack/RSCWebpackPlugin.ts`) is a webpack **plugin**:
code that hooks into the build and can inspect everything webpack knows —
every module, chunk, and chunk group — right before files are written out.
The rspack plugin (`src/react-server-dom-rspack/plugin.ts`) is its mirror for
the rspack bundler; the logic at issue is a line-for-line port, so everything
below applies to both.

What it does, in order:

1. **Discovery.** Find every file with a `'use client'` directive. Each is a
   *client reference*.
2. **Chunk group creation.** For each client reference, inject a dynamic
   `import()` (webpack term: an async dependencies block) so webpack creates
   **one async chunk group per client reference**. This is deliberate: the
   group is webpack's own answer to "what is the complete set of chunks needed
   to run this component?"
3. **Manifest emission** (the `processAssets` hook, where the bug lives). For
   each reference's chunk group:
   - **JS files: recorded group-wide.** Every chunk in the group contributes
     its `.js` file to the entry's `chunks` list, because *all* of a group's
     chunks must load before the module can run
     (`RSCWebpackPlugin.ts:776-790`).
   - **CSS files: recorded per-chunk.** A chunk's `.css` file is attached only
     to client references **whose module physically sits inside that chunk**
     (`RSCWebpackPlugin.ts:886-919`). Why CSS is scoped tighter than JS is a
     history question — §5 tells it — but note the asymmetry now.
   - **A recovery walk** (`directCssDepFiles`, `RSCWebpackPlugin.ts:825-884`)
     patches cases where per-chunk scoping loses a component's own CSS to some
     other chunk. Starting from the reference module it follows its direct
     `import './something.css'` edges, plus **one hop** through a non-CSS child
     module and *that* module's CSS imports — collecting the CSS of whichever
     in-group chunks carry those styles.

That one-hop walk is guarded by the function at the center of this issue:

```ts
// src/webpack/RSCWebpackPlugin.ts:857-865 (main @ b5f2034)
const belongsToReferenceChunkGroup = (depModule: FlightModule): boolean => {
  for (const depChunk of getModuleChunksIterable(depModule)) {
    if (moduleChunks.has(depChunk)) return true;              // child shares the reference's own chunk
    if (groupChunks.has(depChunk) && (chunkGroupUseCount.get(depChunk) ?? 0) === 1) {
      return true;                                            // child's chunk is used by exactly ONE group
    }
  }
  return false;
};
```

In words: *follow a child component's CSS only if the child lives in the
reference's own chunk, or in a chunk that no other chunk group in the entire
build also uses* (`chunkGroupUseCount` counts, for each chunk, how many chunk
groups contain it — `RSCWebpackPlugin.ts:680-688`).

That `=== 1` is the bug.

---

## 3. The failure, step by step

### 3.1 The setup

Three source files (this is the repo's own
`tests/webpack-plugin/fixtures/split-shared-css/` fixture, same shape as the
issue's repro):

```
Button.js        'use client'  →  import './Button.css';        import { shared } from './shared'
SettingsPage.js  'use client'  →  import './SettingsPage.css';  import { shared } from './shared'
shared.js        (plain, NO directive)  →  import './shared.css'
```

`Button` and `SettingsPage` are client components. `shared` is a plain helper
both of them use — think of a `Card` or `Avatar` component used across the app
that nobody marked `'use client'` because it has no interactivity of its own.
It carries its own stylesheet.

The app's webpack config has a SplitChunks rule saying "if `shared.*` is needed
by 2 or more chunks, put it in one chunk named `shared` instead of duplicating
it":

```js
optimization: {
  splitChunks: {
    chunks: 'all', minSize: 0,
    cacheGroups: {
      shared: { test: /shared\.(js|css)$/, name: 'shared', minChunks: 2, enforce: true },
    },
  },
}
```

This is a completely reasonable, common configuration — dedupe shared code.

### 3.2 What webpack builds

Real output of an instrumented build (webpack 5, this repo, `main`):

| chunk | emitted files | in which chunk groups | group use count | initial? |
|---|---|---|---|---|
| `main` | `main.js` | `main` (the entrypoint) | 1 | **yes** |
| `client-Button-js` | `client-Button-js.chunk.js`, `client-Button-js.chunk.css` | Button's group | 1 | no |
| `client-SettingsPage-js` | `client-SettingsPage-js.chunk.js`, `client-SettingsPage-js.chunk.css` | SettingsPage's group | 1 | no |
| `shared` | `shared.chunk.js`, **`shared.chunk.css`** | Button's group **and** SettingsPage's group | **2** | no |

Note three things:

- mini-css-extract gave the `shared` chunk a real CSS file,
  `shared.chunk.css`, containing the `.shared { … }` rules.
- The `shared` chunk sits in **both** references' chunk groups — webpack
  itself is saying "to run Button you need `shared.chunk.js`; same for
  SettingsPage." (And indeed both manifest entries correctly list
  `shared.chunk.js` in their **JS** chunks — the group-wide JS pass has no
  such guard.)
- The `shared` chunk is **async**. It is not part of the `main` entrypoint.
  `stylesheet_pack_tag` will never emit a `<link>` for `shared.chunk.css`.
  If the manifest doesn't claim it, *nothing* delivers it early.

### 3.3 Refusal #1: the per-chunk CSS pass skips it

The per-chunk pass attaches `shared.chunk.css` only to client references whose
module is inside the `shared` chunk. The `shared` chunk contains no
client-reference module — its modules are the plain `shared.js` plus the
css-loader and `css/mini-extract` modules for `shared.css`. For each of them,
`recordModule` checks "is this module one of the discovered `'use client'`
files?" and it is not, so it returns without writing anything
(`RSCWebpackPlugin.ts:720`).

The chunk's CSS is attributed to nobody. This part is by design — plain
modules never get manifest entries — and it means the *only* remaining chance
for `shared.chunk.css` is the recovery walk.

### 3.4 Refusal #2: the recovery walk's guard rejects it

Now the plugin processes Button's chunk group and runs `directCssDepFiles` on
the `Button.js` module:

1. Button's direct CSS import (`Button.css`) is found — that's how
   `client-Button-js.chunk.css` gets attached. Working as intended.
2. Button's non-CSS child `shared.js` is considered for the one-hop walk.
   First the guard runs:
   - Is `shared.js` in one of Button's own chunks (`moduleChunks`)? **No** —
     SplitChunks moved it out, into the `shared` chunk.
   - Is the `shared` chunk in Button's group? **Yes.** Is its
     `chunkGroupUseCount === 1`? **No — it is 2** (Button's group and
     SettingsPage's group both use it; that is precisely what "shared" means).
3. Guard returns `false` → the walk `continue`s past `shared.js`
   (`RSCWebpackPlugin.ts:880`) → `shared.css` is never looked at.

The identical rejection happens while processing SettingsPage's group, because
the count is a global property of the chunk: it is 2 no matter whose group is
being processed. **Any child chunk shared by two or more references is rejected
for all of them, symmetrically.** More sharing — normally a virtue — guarantees
the CSS is orphaned.

### 3.5 The observable result

Manifest (real output):

```jsonc
"Button.js":       { "css": ["/assets/client-Button-js.chunk.css"] }        // no shared.chunk.css
"SettingsPage.js": { "css": ["/assets/client-SettingsPage-js.chunk.css"] }  // no shared.chunk.css
```

`shared.chunk.css` is emitted to disk as an asset, but appears in **zero**
manifest entries. Consequently the Flight payload contains hints for each
component's own CSS and none for the shared file:

```
:HS["/assets/client-Button-js.chunk.css","rsc-css"]         ✓ own CSS hinted
:HS["/assets/client-SettingsPage-js.chunk.css","rsc-css"]   ✓ own CSS hinted
(no :HS for /assets/shared.chunk.css)                       ✗ orphaned
```

### 3.6 Timeline in the browser

1. HTML arrives, server-rendered. Button, SettingsPage, and the shared helper's
   markup are all present immediately.
2. The two hinted stylesheets are in `<head>` as render-blocking links. First
   paint shows Button and SettingsPage fully styled.
3. The shared helper's markup paints **unstyled** — `.shared { … }` exists only
   in `shared.chunk.css`, which nothing has fetched.
4. Hydration begins. Webpack's runtime loads Button's chunk group, including
   `shared.chunk.js`; loading that chunk finally pulls in `shared.chunk.css`.
5. The stylesheet applies. The helper visibly snaps from unstyled to styled.

Steps 3→5 are the FOUC. The single-variable proof from the issue confirms
causation: rebuild with the SplitChunks rule removed (so `shared.js` +
`shared.css` are *duplicated* into each reference's own chunk instead of
shared), and the use count becomes 1, the CSS rides inside each reference's own
`.chunk.css`, and the flash disappears. The **only** difference is sharing.

---

## 4. Why is the guard there at all?

The guard is not arbitrary; it is scar tissue from a genuinely worse bug. The
history matters because the fix must not undo what the guard protects.
(Provenance note: issue #188's claim that the guard came from #108 is slightly
off — #108 established the *invariant*; the guard **code** itself was
introduced much later, in PR #184, merged 2026-07-07, two days before #188 was
filed. Verified with `git log -S 'chunkGroupUseCount'`: exactly one commit,
`0533d53`.)

### 4.1 Issue #108: the broadcast catastrophe (June 2026)

The original manifest code attached CSS **group-wide**: every CSS file in a
reference's chunk group went into that reference's `css[]`. Recall that with
`splitChunks: { chunks: 'all' }`, big shared chunks — `vendor`, `common`,
design-system CSS — can appear inside reference chunk groups *even though the
page entry already loads them*.

Group-wide attachment therefore re-hinted the page's biggest stylesheets once
per client component, as render-blocking `rsc-css` links. On HiChee (the
production app that surfaced it): manifest CSS entries 609, references carrying
vendor CSS 103, home page render-blocking stylesheets 14, First Contentful
Paint degraded from ~2s to ~10s, Lighthouse 79 → 31.

Interesting historical detail: issue #108 *proposed* fixing this by excluding
**initial** chunks — "initial-chunk CSS is already loaded by the page's normal
entry `<link>`s; the rsc-css group should only carry CSS for async chunks."
That is exactly the discriminator the final #188 fix uses. But the fix that
actually merged (PR #110) chose a different rule — **module ownership**: a
chunk's CSS belongs only to references physically inside that chunk. That
fixed HiChee (609 → 82 manifest CSS entries, 103 → 0 vendor-carrying refs) but
traded away correctness for any CSS not co-located with its reference. PR #110
even logged this as a known limitation. PR #111 added the regression test —
**using this very fixture** — which enshrined "shared chunk CSS attaches to
nobody" as the *expected* behavior. That test asserted the #188 bug as
correct, verbatim, for three weeks.

### 4.2 The recovery series: #112/#113, #148/#151, #180/#184

Module-ownership scoping kept losing legitimate CSS, and each loss got patched
with a narrower recovery:

- **PR #113** (issue #112): if SplitChunks moves a reference's *JS* elsewhere
  while its own CSS stays behind, follow the reference's **direct** CSS imports
  to recover it. (Notably, issue #112's design notes already contained the
  fatal equivalence: recovered CSS must not include "shared-dependency CSS
  *already loaded by the page entry*" — silently assuming shared ⇒
  entry-loaded.)
- **PR #151** (issue #148, a P0 that shipped broken in 19.2.0): recover the
  reference's own CSS when a `styles` cacheGroup merges it into a **CSS-only
  chunk**. Issue #148 is the first place the equivalence was proven false in
  production — the styles chunk was *async*, the page entry never loaded it —
  but the lesson was applied only to the reference's own CSS.
- **PR #184** (issue #180, merged 2026-07-07): recover CSS belonging to a
  **plain child** of the reference (exactly our `shared.js` shape) — the
  one-hop walk. Reviews of #184 flagged that a child split into its own chunk
  no longer shares the reference's chunk, so a second acceptance condition was
  added during review: *"or the child's chunk is used by exactly one chunk
  group"* — chunk-privacy as a proxy for safety. That review amendment is the
  `chunkGroupUseCount === 1` line. The review discussion explicitly framed
  `useCount >= 2` chunks as "the #108 broadcast class" to be excluded — nobody
  asked *shared with whom?* And #184 added more tests asserting the exclusion,
  including a CSS-only-shared variant and a server-build variant.

So on `main` today, the one-hop recovery from #184 would find `shared.css`
perfectly — the guard added in #184's own review is the only thing stopping
it, and three tests certify the resulting FOUC as intended.

### 4.3 Why `useCount === 1` is a leaky proxy

The guard's real question is: **"is this chunk's CSS already delivered to the
page by something else?"** The property it actually checks is: **"how many
chunk groups use this chunk?"** Lay out the four combinations and the mismatch
is obvious:

| chunk | use count | already delivered? | guard's decision | correct decision |
|---|---|---|---|---|
| Reference's private child chunk | 1 | no | ✅ attach | attach |
| `vendor` chunk, entry + N refs | ≥ 2 | **yes** (entry `<link>`s) | ✅ exclude | exclude |
| **Shared plain child, refs only** | **≥ 2** | **no — nothing loads it** | ❌ **exclude** | **attach** |
| Entry-only chunk (not in any ref group) | 1 | yes | ✅ (never reached — not in group) | exclude |

Row 3 is issue #188. "Shared" and "already delivered" coincide for vendor
chunks (row 2), which is what everyone had in mind — but a chunk shared only
*among client references* is loaded by no entrypoint, no `<link>` tag, nothing.
Excluding it doesn't avoid double delivery; it produces **zero** delivery
until JavaScript happens to fetch it.

The correct discriminator was available all along, and it is the one webpack
itself maintains: **initial vs. async** (§2.5). Initial ⇒ the page's HTML
delivers the CSS ⇒ exclude. Async ⇒ hints are the only early path ⇒ attach —
to *every* reference whose group contains the chunk, which is safe because
hints deduplicate by URL (§2.2). Empirically, in the fixture build the shared
chunk reports `canBeInitial() === false` while `main` reports `true` — the
signal cleanly separates exactly the rows the use count conflates.

---

## 5. The fix (validated on this branch)

Replace the proxy with the real question, in both plugins:

```ts
// before (webpack: RSCWebpackPlugin.ts:860; rspack mirror: plugin.ts:779)
if (groupChunks.has(depChunk) && (chunkGroupUseCount.get(depChunk) ?? 0) === 1) return true;

// after
if (groupChunks.has(depChunk) && !isInitialChunk(depChunk)) return true;
```

where `isInitialChunk` prefers the chunk's own `canBeInitial()` (public API on
both webpack and rspack chunks) and falls back to membership in any
entrypoint's chunk list. The `chunkGroupUseCount` map is deleted — this guard
was its only consumer.

Verified behavior on this branch:

- The #188 shape attaches `shared.chunk.css` to **both** references (webpack
  and rspack, JS+CSS shared chunks and CSS-only shared chunks, client and
  server builds). The three tests that asserted the orphaning were flipped
  deliberately, with comments explaining why.
- A new canary test pins the #108 invariant: a second entrypoint also imports
  `shared`, making the split chunk **initial** — its CSS must stay (and does
  stay) out of every reference's `css[]`, because `stylesheet_pack_tag`
  already delivers it. This is the test that fails if anyone "simplifies" the
  fix to just deleting the guard.
- Full suite: 284/284 green.

### Known limitations that remain (intentionally out of scope)

- **Depth.** The recovery walk is still bounded to one non-CSS hop
  (a #184 design decision): `ref → Wrapper → Card → Card.css` with `Card` in a
  shared chunk still drops. Same bug class, deeper chain; fixable by the same
  discriminator applied to a deeper walk, at the cost of more graph traversal.
- **Multi-entrypoint granularity.** "Initial" is compilation-wide: a chunk
  initial for entry A is excluded even for a page that only loads entry B.
  The old guard excluded those chunks too (`useCount ≥ 2`), so this is
  strictly no worse — but a per-entry notion of "already delivered" would be
  more precise.
- **rspack topology note.** On rspack *client* builds the plugin rewrites
  `splitChunks.chunks` to shield its generated client chunks from extraction,
  so the #188 topology arises there only when a cacheGroup carries its own
  `chunks: 'all'` override (the standard pattern for styles cache groups) or
  on server builds. The fix covers both.

---

## 6. Pointer map

| What | Where (main @ b5f2034) |
|---|---|
| Use-count map (deleted by fix) | `src/webpack/RSCWebpackPlugin.ts:680-688`; rspack `plugin.ts:711-720` |
| Per-chunk CSS pass (refusal #1) | `src/webpack/RSCWebpackPlugin.ts:886-919`; `recordModule` skip at `:720` |
| Recovery walk | `src/webpack/RSCWebpackPlugin.ts:825-884`; rspack `plugin.ts:739-797` |
| The guard (refusal #2) | `src/webpack/RSCWebpackPlugin.ts:857-865`; rspack `plugin.ts:775-784` |
| Hint emission (manifest → `:HS`) | `src/flight-stylesheet-hints.ts`, `src/flight-server.node.ts:40-42` |
| Fixture with the exact topology | `tests/webpack-plugin/fixtures/split-shared-css/` |
| History | issue #108 → PRs #110/#111; issue #112 → PR #113; issue #148 → PR #151; issue #180 → PR #184 (guard born here, commit `0533d53`); issue #188 (this bug) |
