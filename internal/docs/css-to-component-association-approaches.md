# CSS-to-Component Association Approaches in SSR/RSC Frameworks

> **Internal document — ShakaCode.** Not for public distribution.

## Problem statement

At authoring time, the association is obvious:

```js
// Button.js
import './Button.css';
```

Webpack knows `Button.js -> Button.css` in the module graph. The problem appears later:

1. `MiniCssExtractPlugin` extracts CSS into standalone `.css` assets.
2. `SplitChunksPlugin` is free to move JS modules into different chunks.
3. The emitted JS chunk that contains `Button.js` may no longer be the emitted CSS chunk that contains `Button.css`.

That breaks a question SSR/RSC frameworks must answer during server render:

> "If I render `Button` right now, which CSS asset(s) must be loaded before this HTML can safely reveal?"

This document surveys the main strategies frameworks use to answer that question.

## Why the naive output-level approach fails

The source graph might look like this:

```text
Button.js -> Button.css
```

But the output graph can look like this:

```text
shared-button.chunk.js      contains Button.js
client-Button.chunk.css     contains extracted Button.css
```

If a framework only inspects the JS chunk that owns `Button.js`, it misses `client-Button.chunk.css`.
If it collects every CSS file in the whole chunk group, it over-fetches CSS for siblings and shared
dependencies.

That is the core tension:

- Too narrow: miss CSS.
- Too broad: over-fetch CSS and block rendering unnecessarily.

## 1. Module graph traversal

This is the most direct webpack-native answer: recover CSS ownership from the compilation graph
instead of trusting emitted filenames.

**Mechanism**

Start from a JS module and walk graph edges until you find style modules, then ask the chunk graph
which emitted chunks own those style modules.

```ts
function directCssForModule(module, compilation, groupChunks) {
  const cssFiles = new Set<string>();
  const { moduleGraph, chunkGraph } = compilation;

  for (const connection of moduleGraph.getOutgoingConnections(module)) {
    const depModule = connection.module ?? connection.resolvedModule;
    if (!depModule?.resource) continue;
    if (!STYLE_SOURCE_RE.test(depModule.resource.replace(/[?#].*$/, ''))) continue;

    for (const cssChunk of chunkGraph.getModuleChunksIterable(depModule)) {
      if (!groupChunks.has(cssChunk)) continue;
      for (const file of cssChunk.files) {
        if (file.endsWith('.css')) cssFiles.add(file);
      }
    }
  }

  return [...cssFiles];
}
```

**Important variants**

| System | Direction | Granularity | What it optimizes for |
| --- | --- | --- | --- |
| `react_on_rails_rsc` | JS module -> outgoing CSS deps | Per client reference | Precise per-component CSS hints |
| Next.js `FlightClientEntryPlugin` | Route entry -> outgoing deps | Per route entry | Simpler route-level manifests |
| Gatsby | Mixed outgoing + incoming graph queries | Usually page/entry oriented | Recovering page asset ownership |
| Nuxt (webpack mode) | CSS module -> issuer chain upward | Per owning JS/module tree | Reverse ownership recovery |

**What `react_on_rails_rsc` does**

Our current webpack implementation lives in [`src/webpack/RSCWebpackPlugin.ts`](../../src/webpack/RSCWebpackPlugin.ts).
It combines two graph-based rules:

1. **PR #108: per-chunk CSS scoping**
   Only attach a chunk's CSS to the client references actually present in that chunk, instead of
   broadcasting every CSS file from the whole chunk group.
2. **PR #113: sibling-chunk CSS recovery**
   If `SplitChunksPlugin` moves the JS module into one chunk while `MiniCssExtractPlugin` leaves the
   module's own CSS in a sibling chunk, follow `moduleGraph.getOutgoingConnections()` from the client
   reference to its direct style imports and recover the sibling CSS chunk, intersected with the
   reference's chunk group.

That combination is the key point. `#108` fixes CSS over-broadcast. `#113` restores CSS that would be
lost after that tightening.

**Pros**

- Best fit when you want **per-component** or **per-boundary** precision.
- Can recover CSS even when emitted chunk names no longer line up with module ownership.
- Lets the framework distinguish "my own CSS" from "shared dependency CSS already loaded elsewhere".
- Aligns well with React 19's boundary-local stylesheet gating.

**Cons**

- Deeply coupled to bundler internals (`moduleGraph`, `chunkGraph`, `ConcatenationModule`, issuer
  semantics, synthetic modules).
- Easy to get wrong around CSS loaders, concatenation, resource queries, and shared/transitive deps.
- More framework code to own and test than a route-level manifest approach.
- Traversal rules are subtle: in our implementation only **direct** CSS imports are followed during
  sibling recovery on purpose, to avoid reintroducing broad CSS broadcast.

**Real-world usage**

- `react_on_rails_rsc` uses module-level traversal for per-client-reference CSS.
- Next.js uses the same family of technique, but from the **route entry downward**, aggregating CSS
  into route-level manifests rather than per-component manifests.
- Gatsby-style implementations have used both `getOutgoingConnections()` and
  `getIncomingConnections()` to recover page asset ownership.
- Nuxt webpack-side implementations have used reverse issuer walks (`getIssuer()`) from CSS modules
  upward to the owning JS module tree.

**Relevance to `react_on_rails_rsc`**

This is our primary solution and the best mental model for the current code. If the goal is "emit the
minimum CSS needed for this specific rendered client reference", module graph traversal is the most
natural webpack approach.

## 2. Chunk-group level tracking (stats-based)

This approach steps back from individual modules and trusts webpack's higher-level grouping model.

**Mechanism**

Instead of asking "which CSS module belongs to this JS module?", ask:

> "Which files belong to the chunk group / entrypoint that represents this route or async boundary?"

The key insight is that chunk groups survive splitting better than individual chunks do. After
`SplitChunksPlugin` creates extra JS or CSS chunks, the original chunk group still knows about the
resulting assets.

```ts
const stats = compilation.getStats().toJson({
  all: false,
  chunkGroups: true,
  assets: true,
});

// Exact field names vary by plugin normalization, but the pattern is:
const filesForGroup = stats.namedChunkGroups?.[groupName]?.assets?.map((asset) => asset.name) ?? [];
```

**Pros**

- Uses a stable public output surface instead of digging through webpack's internal module graph.
- Naturally resilient to "JS moved here, CSS emitted there" because the chunk group still sees both.
- Easy to consume from manifest/stat plugins and from external tooling.
- Great for route-level or entry-level asset loading.

**Cons**

- Coarser granularity. It answers "what does this entry/boundary need?" better than "what does this
  exact component need?"
- Tends to over-fetch CSS for sibling modules inside the same route-level boundary.
- Not enough by itself for React 19-style per-component or per-Suspense CSS precision.
- The exact stats shape is plugin-specific enough that most consumers still need normalization code.

**Real-world usage**

- `@loadable/webpack-plugin` emits `loadable-stats.json` from webpack stats data.
  `@loadable/server`'s `ChunkExtractor` reads that manifest to inject CSS `<link>` tags into SSR HTML
  at the chunk-group level. Note that `@loadable/component` (the client-side loader) has **no CSS
  awareness at all** — it is a thin wrapper around `import()` and relies entirely on webpack's runtime
  for CSS loading (see the note on runtime CSS loading below).
- `webpack-manifest-plugin`, `webpack-assets-manifest`, and `webpack-stats-plugin` expose similar
  build-output views.
- Many SSR frameworks use these manifests as infrastructure, even when they still layer their own
  route/component semantics on top.

**Relevance to `react_on_rails_rsc`**

This is a viable route-level fallback, but it is too coarse for our current goal. Our project wants
to attach CSS to a specific client reference, not to the union of every file in an async route group.

## 3. Custom CSS chunking

Instead of recovering the JS-to-CSS association after generic splitting, a framework can prevent the
association from becoming ambiguous in the first place.

**Mechanism**

Next.js ships a custom `CssChunkingPlugin` for webpack. Rather than delegating CSS chunk ownership to
generic `SplitChunksPlugin`, it groups CSS modules itself and applies its own heuristics:

- minimum target size: `30 KB`
- maximum target size: `100 KB`
- order-aware merging
- extra rules to avoid global CSS leaking into unrelated chunks

So the framework controls CSS chunk topology directly instead of reverse-engineering it afterward.

**Pros**

- Eliminates a whole class of "JS in one chunk, CSS in another sibling chunk" surprises.
- Gives the framework tighter control over CSS order and grouping.
- Can improve caching and request-count tradeoffs in a framework-specific way.

**Cons**

- Heavyweight. You are effectively building a custom CSS splitting subsystem.
- Harder to make generic, configurable, and portable outside one framework's assumptions.
- Does not by itself produce per-component ownership; it only makes CSS chunk layout more predictable.
- Still usually paired with route-level manifests, so it can remain broader than necessary.

**Real-world usage**

- Next.js webpack builds use `CssChunkingPlugin`.

**Relevance to `react_on_rails_rsc`**

Interesting in theory, probably too invasive in practice. Our current problem can be solved with
better manifest recovery; we do not need to replace webpack's CSS splitting policy to get correct
per-reference hints.

## 4. Vite/Rollup module graph before bundling

Vite-based SSR frameworks often avoid the webpack-specific pain because they can work from a cleaner
module graph earlier in the pipeline.

**Mechanism**

Before bundling, the framework still sees the original import:

```js
import './button.css';
```

Vite then carries that forward as output metadata:

- `chunk.css`-style output metadata in Rollup ecosystems
- `viteMetadata.importedCss` on output chunks
- `css` arrays in the generated manifest / SSR manifest
- SSR manifest mapping from module IDs to associated JS/CSS/assets

At render time, the framework collects the module IDs actually used during SSR, then looks those IDs
up in the SSR manifest.

```ts
// Production SSR with Vite
const ctx = {};
const html = await renderToString(app, ctx);

// ctx.modules is the set of module IDs used during SSR
for (const id of ctx.modules) {
  const entry = ssrManifest[id];
  for (const cssFile of entry.css ?? []) {
    preloadLinks.add(cssFile);
  }
}
```

**Pros**

- Cleaner than post-hoc webpack recovery because the original module graph is still visible.
- CSS association is a first-class build artifact in Vite SSR.
- Works well with code splitting and render-time module collection.
- Natural fit for frameworks that already collect "modules used during render".

**Cons**

- Bundler-specific. It does not help webpack/Rspack directly.
- Granularity still depends on what the framework records during SSR: route IDs, module IDs, or
  component registrations.
- Usually requires runtime render instrumentation (`ctx.modules`, framework-specific module sets).

**Real-world usage**

- Vite's SSR manifest is the basis for many Vite-powered frameworks.
- Waku, Astro, Remix (Vite mode), and Nuxt (Vite mode) all operate in this general space: collect
  used modules, then map them back to CSS/assets through Vite's manifest metadata.

**Relevance to `react_on_rails_rsc`**

This is the conceptual "easy mode" version of the problem. If `react_on_rails_rsc` ever supported a
Vite backend, this is the model to copy. For webpack, we must reconstruct similar answers from a much
messier post-splitting graph.

## 5. Runtime CSS collection

Some systems avoid build-time ownership recovery and collect styles while rendering.

**Mechanism**

The rendered tree registers its styles into a request-local collector.

Examples:

- `isomorphic-style-loader`: React context plus `useStyles()` / `insertCss()` registration
- `styled-components`: `ServerStyleSheet`
- Emotion: request-local `EmotionCache`
- Vue SSR: `useSSRContext()` or framework-managed SSR context registration

```tsx
const sheet = new ServerStyleSheet();
const html = renderToString(sheet.collectStyles(<App />));
const styleTags = sheet.getStyleTags();
```

**Pros**

- Perfectly aligned with what actually rendered, including conditionals.
- No need to infer ownership from emitted chunk topology.
- Works very well for CSS-in-JS systems where styles are generated or registered at runtime.

**Cons**

- Usually incompatible with the `MiniCssExtractPlugin` model of "CSS is a standalone emitted file".
- Adds request-time bookkeeping.
- Often library-specific rather than framework-generic.
- Can make caching, deduplication, and CSP concerns more complicated.

**Real-world usage**

- Common in CSS-in-JS ecosystems.
- Historically used by SSR setups that keep CSS as runtime data rather than extracted assets.

**Relevance to `react_on_rails_rsc`**

Mostly orthogonal. Our project is solving extracted-asset association for webpack builds, not runtime
style-string collection. `isomorphic-style-loader` in particular is the wrong tool once
`MiniCssExtractPlugin` has already turned CSS into separate files.

## 6. CSS as a static/build-time problem

In some ecosystems the "association" problem mostly disappears because CSS ownership is already known
statically or because everything collapses into one stylesheet.

**Mechanism**

Examples:

- **Zero-runtime CSS-in-JS** (`vanilla-extract`, `Linaria`, `StyleX`): compile style definitions to
  generated CSS plus deterministic class references.
- **Tailwind CSS**: often one global stylesheet for the whole app.
- **Angular**: component styles are compiled into `defineComponent()` metadata, so ownership is
  explicit in the compiled component definition.
- **Single CSS bundle strategies**: if the build always ships one global CSS asset, no per-component
  lookup is needed.

**Pros**

- Little or no runtime ownership recovery needed.
- Usually simpler operational model.
- Avoids the webpack `MiniCssExtractPlugin` + `SplitChunksPlugin` ambiguity entirely.

**Cons**

- Changes the authoring model or the bundling model.
- May give up fine-grained CSS code splitting.
- Global stylesheets can hurt first-load performance on large apps.

**Real-world usage**

- Zero-runtime CSS compilers across React ecosystems.
- Tailwind-heavy applications.
- Angular's component compiler model.
- Some Gatsby configurations that effectively collapse CSS into one shared output.

**Relevance to `react_on_rails_rsc`**

This is more "change the problem" than "solve the current problem". It is useful context, but not a
drop-in answer for a framework that must support arbitrary webpack CSS imports.

## 7. React 19 streaming with `precedence`

React 19 adds a native delivery primitive for CSS during streaming SSR. It does **not** solve
ownership discovery, but it greatly improves what a framework can do once it knows the right CSS.

**Mechanism**

React treats a stylesheet with `precedence` specially:

```jsx
<link rel="stylesheet" href={href} precedence="rsc-css" />
```

or:

```ts
preinit(href, { as: 'style', precedence: 'rsc-css' });
```

Key behaviors:

- React places stylesheet links in `<head>`.
- The component that renders a stylesheet link suspends while that stylesheet is loading.
- If a streamed Suspense boundary depends on styles that are not ready yet, React emits `$RR(...)`
  logic to insert/load those styles and reveal the boundary only after they settle.
- If the styles are already ready, React can reveal directly with `$RC(...)`.

That means React now supports **boundary-local CSS blocking**, not just whole-page blocking.

**Pros**

- Best UX story for streamed SSR/RSC when CSS ownership is precise.
- Lets CSS block only the boundary that needs it.
- Dedupes repeated stylesheet hints by URL.

**Cons**

- Requires the framework to know the correct CSS for the boundary/component.
- Route-level manifests can blunt the benefit by promoting too much CSS into the initial head.
- Still easy for frameworks to choose the simpler but broader "put it all in `<head>` up front"
  policy.

**Real-world usage**

- Raw React 19 provides the primitive.
- `react_on_rails_rsc` uses this via [`src/flight-stylesheet-hints.ts`](../../src/flight-stylesheet-hints.ts),
  which calls `preinit(href, { as: 'style', precedence: 'rsc-css' })` for manifest `css` entries.
- Next.js generally chooses the broader route-level strategy: it tends to arrange for route CSS to
  already be in `<head>`, so async boundaries do not need fine-grained `$RR`-style stylesheet gating
  as often.

**Relevance to `react_on_rails_rsc`**

Very high. This is why per-component CSS precision matters. The closer our manifest is to "only the
CSS that this client reference actually needs", the closer we get to React's ideal streaming model.

## 8. React Flight protocol CSS handling

React Flight provides transport for module references and resource hints, but it does **not** give a
framework a ready-made CSS ownership map.

**Mechanism**

Two separate facts matter:

1. `ReactFlightWebpackPlugin` discovers client references from JS/TS modules and ignores CSS as a
   first-class manifest concern.
2. CSS travels through the hint channel once the framework already knows which stylesheet to hint.

In practice:

- Framework-owned code decides that a rendered client reference needs `x.css`.
- It emits a hint with `preinitStyle(...)` / `ReactDOM.preinit(...)`.
- Flight serializes that as an `"H"` row with `"S"` payload semantics.
- The client consumes the hint and loads the stylesheet.

React core intentionally leaves "which CSS belongs to which module?" to the framework/bundler layer.

**Pros**

- Keeps React core bundler-agnostic.
- Provides a standard delivery mechanism once the framework has computed ownership.

**Cons**

- Every SSR/RSC framework must solve CSS tracking itself.
- There is no standard reusable webpack package that supplies module-level CSS ownership for
  `MiniCssExtractPlugin`.
- This is why major frameworks end up with custom plugins and manifests.

**Real-world usage**

- `react_on_rails_rsc`, Next.js, and other webpack-based RSC frameworks all own CSS tracking outside
  of React core.
- Parcel RSC experiments take a different render-time shape but still solve the same missing layer:
  attach styles to the client component reference somehow, sometimes by rendering a `<link>` sibling
  next to the component boundary rather than by manifest hints.

**Relevance to `react_on_rails_rsc`**

This is the architectural reason our plugin exists at all. React gives us the transport primitive and
the reveal-time behavior, but not the CSS-to-component mapping.

## Note: runtime CSS loading during client-side `import()`

The approaches above address the **server-side** problem: which CSS `<link>` tags to include in the
HTML response. There is a complementary **client-side** mechanism that is easy to overlook.

When `mini-css-extract-plugin` extracts CSS into standalone files, it also registers a runtime chunk
handler in webpack's output: `__webpack_require__.f.miniCss`. This handler participates in every
dynamic `import()` call:

```js
// Simplified from mini-css-extract-plugin's CssLoadingRuntimeModule output
__webpack_require__.f.miniCss = function (chunkId, promises) {
  if (chunkHasCss(chunkId)) {
    promises.push(
      new Promise(function (resolve, reject) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = getCssFilename(chunkId);
        link.onload = resolve;   // resolves only when CSS is downloaded + parsed
        link.onerror = reject;
        document.head.appendChild(link);
      })
    );
  }
};
```

Because `__webpack_require__.e(chunkId)` calls **all** registered handlers (JS loader, CSS loader,
etc.) and returns `Promise.all(promises)`, the `import()` promise does not resolve until both the JS
**and** the CSS for that chunk have loaded. The component code cannot execute — and therefore cannot
render — until CSS is ready.

**Practical consequence:** for client-side dynamic imports with `mini-css-extract-plugin`, FOUC
(Flash of Unstyled Content) does not occur. This is true regardless of what sits on top of
`import()` — `React.lazy`, `@loadable/component`, or plain `import().then(...)`. The protection is
in webpack's runtime, not in any React library.

This means the CSS association problem described in this document is primarily an **SSR concern**:
determining which `<link>` tags to include in the server-rendered HTML so that initial paint and
streamed Suspense boundary reveals have CSS available. Once the client takes over and uses `import()`
for subsequent code-split chunks, webpack's runtime handles CSS delivery automatically.

**Where FOUC _can_ still occur on the client:**

- `style-loader` (embeds CSS in JS, injects `<style>` tags after execution — no `onload` gating)
- CSS-in-JS libraries that generate styles at runtime (styled-components, emotion)
- Dynamically constructed `<link>` tags outside of webpack's chunk loading system

## Practical takeaways

- As of 2026-06, there does not appear to be a de facto standalone npm package that provides
  webpack-level, module-granular CSS association for `MiniCssExtractPlugin`. Frameworks that need this
  behavior tend to ship bespoke plugins.
- The industry tradeoff is mostly **granularity vs simplicity**:
  module-graph walking is precise but complex; chunk-group and route-entry approaches are simpler but
  broader.
- Next.js' route-level model is intentionally broader than our current model. It simplifies route
  loading, but it also tends to front-load CSS for async client subtrees that a per-component manifest
  could defer.
- React 19 finally gives frameworks a strong runtime delivery primitive (`precedence`, `$RR`, `$RC`),
  but it still does not compute ownership.
- `react_on_rails_rsc` currently sits in the most precise webpack camp: per-client-reference CSS
  scoping plus direct CSS dependency recovery.

## Selected references

- [`react_on_rails_rsc` `RSCWebpackPlugin.ts`](../../src/webpack/RSCWebpackPlugin.ts)
- [`react_on_rails_rsc` `flight-stylesheet-hints.ts`](../../src/flight-stylesheet-hints.ts)
- [Next.js `FlightClientEntryPlugin`](https://github.com/vercel/next.js/blob/canary/packages/next/src/build/webpack/plugins/flight-client-entry-plugin.ts)
- [Next.js `CssChunkingPlugin`](https://github.com/vercel/next.js/blob/canary/packages/next/src/build/webpack/plugins/css-chunking-plugin.ts)
- [Webpack stats data docs](https://webpack.js.org/api/stats/)
- [Vite SSR guide](https://main.vitejs.dev/guide/ssr.html)
- [React `preinit`](https://react.dev/reference/react-dom/preinit)
- [React `<link>` stylesheet behavior](https://react.dev/reference/react-dom/components/link)
- [React `ReactFlightWebpackPlugin`](https://github.com/facebook/react/blob/main/packages/react-server-dom-webpack/src/ReactFlightWebpackPlugin.js)

## Comparison table

| Approach | Stage | Granularity | Handles `MiniCssExtractPlugin` + `SplitChunksPlugin` divergence well? | Main advantage | Main downside | Typical users | Fit for `react_on_rails_rsc` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Module graph traversal | Build time, bundler internals | Per component / per entry, depending on traversal root | Yes, if implemented carefully | Highest precision | Most complex | `react_on_rails_rsc`, Next.js, Gatsby, Nuxt webpack | Best fit for current design |
| Chunk-group tracking | Build time, stats/manifest layer | Per route / per async entry | Yes, at group level | Simpler and robust to splitting | Over-fetches within a group | `@loadable/server` + `@loadable/webpack-plugin`, manifest/stat plugins | Useful fallback, too coarse as primary model |
| Custom CSS chunking | Build time, custom optimizer | Usually route/chunk oriented | Avoids much of the divergence by design | Predictable CSS topology | Heavy framework machinery | Next.js | Interesting but likely overkill |
| Vite/Rollup pre-bundle graph | Build + render-time module collection | Module set used during SSR | Yes, via manifest metadata | Cleaner ownership data | Vite/Rollup specific | Waku, Astro, Remix Vite, Nuxt Vite | Relevant only for a future Vite backend |
| Runtime CSS collection | Render time | Exact rendered tree | Not really; it sidesteps extracted-file ownership | Perfect conditional accuracy | Incompatible with extracted CSS workflows | CSS-in-JS, `isomorphic-style-loader` | Orthogonal, not a replacement |
| Static/build-time CSS model | Compile time | Usually explicit or global | Problem often disappears | Very simple runtime | Changes authoring/bundling model | Tailwind, Angular, vanilla-extract, Linaria, StyleX | Context only, not a drop-in answer |
| React 19 `precedence` streaming | Render/stream time | Per Suspense boundary | Only after ownership is already known | Best delivery primitive | Does not compute ownership | Raw React 19, frameworks with precise manifests | Highly relevant downstream primitive |
| React Flight hint channel | Protocol/runtime boundary | N/A by itself | No; transport only | Standard way to ship hints | Forces every framework to solve mapping itself | All RSC frameworks | Explains why our plugin must exist |
