# How RSC Plugins Inject Client Components Into Bundles

A deep dive into why the injection-loader approach works and `addInclude` breaks hydration in rspack production builds. Written for readers who have never looked inside webpack or rspack.

---

## Table of Contents

1. [What a Bundler Does](#1-what-a-bundler-does)
2. [Modules and the Module Map](#2-modules-and-the-module-map)
3. [The Runtime](#3-the-runtime)
4. [Chunks: Entry vs Async](#4-chunks-entry-vs-async)
5. [The Plugin System and Compilation Hooks](#5-the-plugin-system-and-compilation-hooks)
6. [The RSC Problem: Why Client Components Need Injection](#6-the-rsc-problem-why-client-components-need-injection)
7. [Approach A: `addInclude` (Entry-Level Injection)](#7-approach-a-addinclude-entry-level-injection)
8. [Approach B: Injection-Loader (Dynamic Import Injection)](#8-approach-b-injection-loader-dynamic-import-injection)
9. [Why `addInclude` Breaks Hydration](#9-why-addinclude-breaks-hydration)
10. [Why Injection-Loader Works](#10-why-injection-loader-works)
11. [The Server Bundle: A Different Story](#11-the-server-bundle-a-different-story)
12. [The Ideal Hybrid Solution](#12-the-ideal-hybrid-solution)
13. [Production Build Evidence](#13-production-build-evidence)

---

## 1. What a Bundler Does

Your application is made of hundreds of JavaScript files. Browsers cannot efficiently load hundreds of files one at a time. A **bundler** (webpack or rspack) takes all those files, resolves their `import`/`require` relationships, and produces a small number of output files called **bundles**.

```
Source files                     Bundler output
-----------                      --------------
src/App.tsx          ─┐
src/Header.tsx        ├──→  [webpack / rspack]  ──→  bundle.js  (contains all three)
src/utils/format.ts  ─┘
```

webpack and rspack are functionally equivalent. rspack is a Rust-based reimplementation that produces the same output format but builds 5-10x faster. Everything in this document applies to both unless noted otherwise.

---

## 2. Modules and the Module Map

Inside the output bundle, each source file becomes a **module** identified by a numeric ID. The bundler creates a data structure called the **module map** — a plain JavaScript object where each key is a module ID and each value is the module's code wrapped in a function.

Here is a simplified view of what a bundle looks like inside:

```js
// Simplified bundle structure
var modules = {
  // Module 72553: originally src/Header.tsx
  72553: function(module, exports, require) {
    // ... compiled code from Header.tsx ...
    var utils = require(31938);  // load module 31938 (format.ts)
    exports.Header = function() { /* ... */ };
  },

  // Module 31938: originally src/utils/format.ts
  31938: function(module, exports, require) {
    exports.formatPrice = function(n) { return '$' + n.toFixed(2); };
  },

  // Module 52385: originally src/App.tsx
  52385: function(module, exports, require) {
    var Header = require(72553);
    // ...
  },
};
```

The numeric IDs (72553, 31938, 52385) are assigned by the bundler during compilation. They are stable within a single build but can change between builds. **Every module in the bundle must have a numeric ID in this map to be loadable.**

---

## 3. The Runtime

The **runtime** is a small piece of JavaScript that the bundler adds to the output. It is the engine that makes the module map work. Its core job is simple:

```js
// Simplified runtime
var cache = {};

function __webpack_require__(moduleId) {
  // If already loaded, return from cache
  if (cache[moduleId]) return cache[moduleId].exports;

  // Create a new module object, run its factory function
  var module = cache[moduleId] = { exports: {} };
  modules[moduleId](module, module.exports, __webpack_require__);

  return module.exports;
}
```

When any module calls `require(72553)`, the runtime looks up ID 72553 in the module map, runs its function, caches the result, and returns it. **If a module ID is not in the module map, `__webpack_require__` fails.**

In a simple application, there is one module map and one runtime. But real applications use **chunks** to split code — and that is where the complexity begins.

---

## 4. Chunks: Entry vs Async

A **chunk** is a group of modules packaged into a single output `.js` file. The bundler splits your code into multiple chunks for performance: the browser loads only what it needs upfront and fetches the rest on demand.

There are two fundamentally different types of chunks, and the distinction between them is **the central concept of this entire document**.

### Entry Chunks

An **entry chunk** is the first script loaded on the page via a `<script>` tag. It contains the runtime and an initial set of modules. It is self-contained.

```html
<!-- This loads the entry chunk -->
<script src="/js/application.js"></script>
```

The entry chunk's internal structure looks like this:

```js
// Entry chunk: self-contained IIFE (Immediately Invoked Function Expression)
(() => {
  var modules = {
    52385: function(m, e, r) { /* App.tsx */ },
    72553: function(m, e, r) { /* Header.tsx */ },
  };

  var cache = {};
  function __webpack_require__(id) {
    if (cache[id]) return cache[id].exports;
    var m = cache[id] = { exports: {} };
    modules[id](m, m.exports, __webpack_require__);
    return m.exports;
  }

  // Boot the application
  __webpack_require__(52385);
})();
```

Key properties of entry chunks:
- Wrapped in `(() => { ... })()` — an IIFE that creates its own scope
- Contains its **own runtime** (its own `__webpack_require__`, its own `cache`, its own `modules` map)
- **Self-contained**: does not share state with any other chunk
- Executes immediately when the `<script>` tag loads

### Async Chunks

An **async chunk** is loaded on demand — typically when the user navigates to a new page or triggers lazy loading. It does NOT have its own runtime. Instead, it **registers its modules with the entry chunk's shared runtime**.

```js
// Async chunk: registers with the shared runtime
"use strict";
(self.rspackChunklocalhub_demo = self.rspackChunklocalhub_demo || []).push([
  [3635],    // chunk ID(s)
  {
    // New modules to add to the shared module map
    87078: function(m, e, r) { /* ProductSpecSheet.tsx */ },
    31938: function(m, e, r) { /* RelatedPosts.tsx */ },
  }
]);
```

Key properties of async chunks:
- **No IIFE wrapper** — it is just a `.push()` call
- **No runtime of its own** — it registers modules into the existing shared `self.rspackChunklocalhub_demo` array
- The entry chunk's runtime listens on this array (via a patched `.push`) and merges the new modules into the shared module map
- Once registered, these modules are available to `__webpack_require__()` just like any other module

### `runtimeChunk: 'single'`

By default, each entry chunk contains its own copy of the runtime. With the configuration option `runtimeChunk: 'single'`, the runtime is extracted into a separate shared file (e.g., `runtime.js`). All entry chunks then depend on this shared runtime instead of each having their own copy.

```
Without runtimeChunk: 'single':
  application.js  →  [runtime + modules]     (own runtime)
  BlogPostSSR.js  →  [runtime + modules]     (own runtime — duplicate!)

With runtimeChunk: 'single':
  runtime.js      →  [runtime only]          (shared)
  application.js  →  [modules only]          (uses shared runtime)
  BlogPostSSR.js  →  [modules only]          (uses shared runtime)
```

**Important caveat**: `runtimeChunk: 'single'` only applies to entries that exist at configuration time. Entries added later during compilation may not participate in this optimization (more on this in section 9).

### Why the Distinction Matters

The Flight runtime (React's RSC client) loads client component modules by calling `__webpack_chunk_load__(chunkId)` and then `__webpack_require__(moduleId)`. This works because:

1. `__webpack_chunk_load__` fetches the async chunk's `.js` file from the server
2. The async chunk's code runs: `self.rspackChunk.push(...)` adds modules to the shared map
3. `__webpack_require__(moduleId)` finds the module in the shared map and returns it

If the module is inside a standalone IIFE (an entry chunk), step 2 never happens — the module is trapped inside the IIFE's private scope. The shared runtime cannot see it. `__webpack_require__` fails.

---

## 5. The Plugin System and Compilation Hooks

Both webpack and rspack have a **plugin system** that lets you hook into different stages of the build process. The build proceeds through a well-defined sequence of stages:

```
1. Configuration        — read webpack.config.js / rspack.config.js
2. Compilation start    — create compiler, apply plugins
3. beforeCompile        — last chance to do setup before modules are resolved
4. make                 — resolve entries, build module graph (loaders run here)
5. finishMake           — all entry modules built, but assets not yet sealed
6. seal                 — optimize modules, assign IDs, split chunks
7. processAssets        — emit final files to disk
```

### Hooks

A **hook** is a named point in the build lifecycle where plugins can register callbacks. For example:

```js
// Plugin that runs code before compilation starts
compiler.hooks.beforeCompile.tapAsync('MyPlugin', (params, callback) => {
  console.log('About to start compiling!');
  callback();
});
```

The hooks relevant to this document:

| Hook | When it fires | What plugins do here |
|------|---------------|---------------------|
| `beforeCompile` | Before module resolution begins | FS-walk to discover "use client" files |
| `make` | During module graph building | Loaders transform source code |
| `finishMake` | After all modules built, before sealing | Last chance to add modules to the graph |
| `processAssets` | After chunks are finalized | Emit manifest JSON files |

### Loaders

A **loader** is a function that transforms source code during the `make` phase. Every file passes through zero or more loaders before the bundler processes it. For example, `swc-loader` compiles TypeScript to JavaScript, and `css-loader` handles CSS imports.

```js
// A simplified loader
module.exports = function(source) {
  // 'source' is the file's text content
  // Transform it and return the result
  return source.replace('__DEV__', 'false');
};
```

Loaders run **during module graph building** (step 4). This is important because the bundler's standard code-splitting and chunk-creation machinery processes the loader's output. If a loader adds `import('./Foo.tsx')` to the source, the bundler sees it as a normal dynamic import and creates a proper async chunk for `Foo.tsx`.

### The `compilation.addInclude` API

`addInclude` is a programmatic API that lets a plugin add a module to an entry's dependency list **after the initial module graph is built** (typically called during `finishMake`).

```js
compiler.hooks.finishMake.tapAsync('MyPlugin', (compilation, callback) => {
  const dep = EntryPlugin.createDependency('./ClientComponent.tsx', { name: 'client0' });
  compilation.addInclude(context, dep, { name: 'client0' }, (err, module) => {
    callback();
  });
});
```

Internally, `addInclude` calls `_addEntryItem` with a target of `"includeDependencies"`:

```js
// Inside webpack/rspack Compilation.js
addInclude(context, dependency, options, callback) {
  this._addEntryItem(context, dependency, "includeDependencies", options, callback);
}

_addEntryItem(context, entry, target, options, callback) {
  const { name } = options;
  let entryData = this.entries.get(name);

  if (entryData === undefined) {
    // Name doesn't match any existing entry → create a NEW entry
    entryData = {
      dependencies: [],
      includeDependencies: [],
      options: { name, ...options }
    };
    entryData[target].push(entry);
    this.entries.set(name, entryData);
  } else {
    // Name matches an existing entry → append to that entry
    entryData[target].push(entry);
  }
}
```

The behavior depends entirely on whether the `name` matches an existing entry:

- **Existing name**: The module is added to that entry's `includeDependencies`. No new entry or chunk is created. The module ends up in the existing entry's chunk with a proper numeric ID.
- **New name**: A new entry is created. This results in a new entry chunk — a standalone IIFE with its own runtime.

---

## 6. The RSC Problem: Why Client Components Need Injection

In React Server Components (RSC), the application is split into two kinds of components:

- **Server components**: Run only on the server. They can access databases, read files, etc. They are never sent to the browser.
- **Client components**: Marked with `"use client"` at the top of the file. They run on both the server (for SSR — Server-Side Rendering) and the browser (for hydration and interactivity).

The bundler produces three separate bundles:

```
1. Client bundle      — runs in the browser, handles hydration + interactivity
2. Server (SSR) bundle — runs on the server, renders initial HTML for client components
3. RSC bundle          — runs on the server, executes server components
```

### The Discovery Problem

The client and SSR bundles need to include every `"use client"` component. But here's the issue: **these components may not be imported by the bundle's entry file**.

Consider this component tree:

```
ServerPage.tsx (server component — RSC bundle only)
  └── BlogContent.tsx (server component)
        └── BookmarkShareBar.tsx ("use client" — needs to be in client + SSR bundles!)
```

`BookmarkShareBar.tsx` is imported by `BlogContent.tsx`, which is a server component. Server components exist only in the RSC bundle. The client bundle's entry point (`application.js`) has no import chain leading to `BookmarkShareBar.tsx`. Without intervention, the bundler would never include it in the client or SSR bundles.

### The Manifest

The RSC plugin also produces **manifest JSON files** that map file paths to module IDs and chunk information:

```json
{
  "filePathToModuleMetadata": {
    "file:///app/components/BookmarkShareBar.tsx": {
      "id": 87078,
      "chunks": [3635, "js/client0-abc123.chunk.js"],
      "name": "*"
    }
  }
}
```

The **client manifest** tells the browser which chunks to load when the RSC payload references a client component. The **server manifest** tells the SSR runtime which module ID to `__webpack_require__` when it needs to render a client component on the server.

For both manifests to work, the modules must exist in their respective bundles with proper numeric IDs.

### The Plugin's Job

The RSC plugin has three phases:

1. **Phase 1 (beforeCompile)**: Walk the filesystem, find every file with `"use client"`, build a list of discovered files.
2. **Phase 2 (make or finishMake)**: Inject those discovered files into the bundle so the bundler includes them even though nothing in the entry graph imports them.
3. **Phase 3 (processAssets)**: Walk the compiled module graph, build manifest JSON files mapping each client component to its module ID and chunk location.

Phase 2 is the critical one. There are two approaches to injecting modules, and they produce fundamentally different results.

---

## 7. Approach A: `addInclude` (Entry-Level Injection)

The `addInclude` approach uses the `compilation.addInclude` API during the `finishMake` hook to programmatically add each discovered client file to the bundle.

```js
// Phase 2: addInclude approach (simplified)
compiler.hooks.finishMake.tapAsync('RSCPlugin', (compilation, callback) => {
  let pending = discoveredClientFiles.length;

  for (let i = 0; i < discoveredClientFiles.length; i++) {
    const file = discoveredClientFiles[i];
    const name = `client${i}`;  // e.g., "client0", "client1", "client2"

    const dep = EntryPlugin.createDependency(file, { name });
    compilation.addInclude(context, dep, { name }, (err, module) => {
      // Mark exports to prevent mangling
      compilation.moduleGraph.getExportsInfo(module)
        .setUsedInUnknownWay(runtime);

      if (--pending === 0) callback();
    });
  }
});
```

For the **client bundle**, `name` is a new unique name like `"client0"`, `"client1"`, etc. Since no existing entry has these names, `addInclude` creates **new entries** — one per client component.

For the **server bundle**, the plugin reuses the existing server entry name (e.g., `"server-bundle"`). Since this name already exists, `addInclude` appends to the existing entry's `includeDependencies`. No new entries are created.

### How the original webpack RSC plugin does it

The original React webpack plugin (ReactFlightWebpackPlugin) uses a completely different API: `AsyncDependenciesBlock`. Instead of creating entries, it attaches async dependency blocks to an existing module (the Flight client runtime):

```js
// Original webpack approach (simplified)
parser.hooks.program.tap("ReactServerPlugin", () => {
  const module = parser.state.module;
  if (module.resource === clientRuntimePath) {
    for (const dep of discoveredClientFiles) {
      const block = new webpack.AsyncDependenciesBlock({ name: `client${i}` });
      block.addDependency(dep);
      module.addBlock(block);  // Attach as async child of the runtime module
    }
  }
});
```

`AsyncDependenciesBlock` creates **async chunks** attached to a parent module. These are fundamentally different from entry chunks — they register with the shared runtime rather than being self-contained.

**rspack does not expose `AsyncDependenciesBlock` as a public API.** This is why the RSC rspack plugin cannot simply copy the webpack approach and must find an alternative.

---

## 8. Approach B: Injection-Loader (Dynamic Import Injection)

The injection-loader approach avoids `addInclude` entirely for the client bundle. Instead, it uses a **loader** (a source-code transformer) that runs during the normal `make` phase.

The idea: prepend `import()` statements to the Flight client runtime module. The bundler processes these imports like any other dynamic import and creates proper async chunks.

### The Loader

```js
// injection-loader.ts (simplified)
export let _discoveredClientFiles = [];

function InjectionLoader(source) {
  if (!_discoveredClientFiles.length) return source;

  // Generate import() statements for each client file
  const imports = _discoveredClientFiles.map((file, i) => {
    return `import(/* webpackChunkName: "client${i}" */ "${file}");`;
  });

  // Prepend to the original source
  return imports.join('\n') + '\n' + source;
}
```

### The Plugin Setup

```js
// In the plugin's apply() method (simplified)
compiler.hooks.beforeCompile.tapAsync('RSCPlugin', (params, callback) => {
  // Phase 1: discover "use client" files
  discoveredClientFiles = walkAndFind(compiler.context);

  // Set the loader's state (plugin and loader share the same Node process)
  injectionLoader._discoveredClientFiles = discoveredClientFiles;
  callback();
});

// Register the loader: it only runs on the Flight client runtime file
compiler.options.module.rules.push({
  test: (resource) => resource === 'node_modules/.../client.browser.js',
  enforce: 'pre',
  use: [{ loader: require.resolve('./injection-loader.js') }],
});
```

### What Happens at Build Time

When rspack processes `client.browser.js` (the Flight client runtime), the injection-loader runs first and transforms the source:

```js
// Before (original client.browser.js):
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ... React Flight client runtime code ...

// After (injection-loader output):
import(/* webpackChunkName: "client0" */ "/app/components/BlogPostClient.tsx");
import(/* webpackChunkName: "client1" */ "/app/components/BookmarkShareBar.tsx");
import(/* webpackChunkName: "client2" */ "/app/components/ProductSpecSheet.tsx");
// ... more imports ...
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ... React Flight client runtime code ...
```

The bundler then processes these `import()` calls through its standard code-splitting pipeline — the same pipeline it uses for any `import()` in your application code. Each `import()` creates an **async chunk**.

---

## 9. Why `addInclude` Breaks Hydration

### The Timeline Problem

Here is what happens during a build with `addInclude`:

```
Step 1: Configuration
  → runtimeChunk: 'single' is configured
  → Entries are: ["application", "BlogPostSSR", "ProductPageSSR", ...]
  → rspack records: "these entries share a single runtime"

Step 2-4: make phase
  → rspack resolves and builds all modules for the configured entries
  → runtimeChunk: 'single' applies — all entries will share one runtime

Step 5: finishMake
  → RSCPlugin calls addInclude for each client file
  → 39 new entries created: "client0", "client1", ..., "client38"
  → These entries were NOT present during runtimeChunk configuration
  → rspack does NOT retroactively apply runtimeChunk: 'single' to them

Step 6: seal
  → Original entries → modules go into shared chunks, use shared runtime
  → addInclude entries → each gets its own IIFE with its own private runtime
```

### The Result

The output contains two kinds of chunk files:

```
Shared-runtime chunks (correct):
  js/runtime-9d46acd3.js           ← shared runtime
  js/application-3cb03b35.js       ← registers via rspackChunk.push()
  js/6421-521f7a08.js              ← registers via rspackChunk.push()

addInclude entry chunks (broken):
  js/client0-613ac275.js           ← standalone IIFE, own private runtime
  js/client13-6b0f769a.js          ← standalone IIFE, own private runtime
  js/client22-849ea623.js          ← standalone IIFE, own private runtime
```

### Why Hydration Fails

When the browser receives an RSC payload like:

```
M1:{"id":87078,"chunks":[3555,"js/client13-6b0f769a.js"],"name":"ProductSpecSheet"}
```

The Flight runtime does:

1. Call `__webpack_chunk_load__("js/client13-6b0f769a.js")` — fetches the file
2. The file loads and executes... but it is an IIFE: `(() => { var modules = {...}; ... })()`
3. The IIFE defines module 87078 **inside its own private scope**
4. The Flight runtime calls `__webpack_require__(87078)` on the **shared runtime**
5. The shared runtime looks in its module map — module 87078 is not there
6. **Error**: the module is trapped inside the IIFE's private closure

The component cannot be found. React throws "Element type is invalid" or a hydration error. Buttons don't work. Interactivity is broken.

### Bundle Size Bloat

Because each IIFE is self-contained, every client chunk must include its own copy of shared dependencies:

```
With addInclude (IIFE entries):
  client0.js:   React (50KB) + BlogPostClient (8KB)     = 58KB
  client13.js:  React (50KB) + ProductSpecSheet (12KB)   = 62KB
  client22.js:  React (50KB) + RestaurantMenu (15KB)     = 65KB
  ... × 39 chunks = React duplicated 39 times

With injection-loader (async chunks):
  6421.js:      React (50KB)  ← shared, loaded once
  client0.js:   BlogPostClient (8KB)    ← just the unique code
  client13.js:  ProductSpecSheet (12KB) ← just the unique code
  client22.js:  RestaurantMenu (15KB)   ← just the unique code
```

Measured from actual production builds:

| | addInclude | injection-loader |
|---|---|---|
| Total JS output | **11 MB** | **8 MB** |
| Client chunk total | 336 KB | 220 KB |

---

## 10. Why Injection-Loader Works

### The Timeline (Correct)

```
Step 1: Configuration
  → runtimeChunk: 'single' is configured
  → Entries are: ["application", "BlogPostSSR", ...]
  → injection-loader rule registered on client.browser.js

Step 2-4: make phase
  → rspack resolves client.browser.js
  → injection-loader runs: prepends import() statements to the source
  → rspack sees: import("./BookmarkShareBar.tsx"), import("./ProductSpecSheet.tsx"), ...
  → rspack creates async chunk groups for each import (standard code-splitting)
  → These are ASYNC chunks of client.browser.js, not new entries

Step 5: finishMake
  → Nothing extra — injection already happened during make

Step 6: seal
  → runtimeChunk: 'single' applies to all entries (no late entries were added)
  → Async chunks use rspackChunk.push() format
  → splitChunks extracts shared modules (React, etc.) into common chunks
```

### The Result

Every client chunk uses the async chunk format:

```js
// client0-eb751674.chunk.js — proper async chunk
"use strict";
(self.rspackChunklocalhub_demo = self.rspackChunklocalhub_demo || []).push([
  [3635],
  {
    52385: function(r, e, t) { /* BlogPostClient code */ },
    31938: function(r, e, t) { /* RelatedPosts code */ },
  }
]);
```

When the Flight runtime loads this chunk:

1. `__webpack_chunk_load__("js/client0-eb751674.chunk.js")` — fetches the file
2. The file executes: `self.rspackChunklocalhub_demo.push(...)` registers modules into the shared map
3. `__webpack_require__(52385)` finds the module in the shared map
4. The component renders. Hydration succeeds. Buttons work.

### Why This Mirrors the Original webpack Plugin

The original React webpack plugin uses `AsyncDependenciesBlock` to attach async dependencies to the Flight client runtime module. The bundler creates async chunk groups for each block.

The injection-loader achieves the same result through a different mechanism: `import()` statements also create async chunk groups. From the bundler's perspective, the effect is identical — the Flight client runtime module has async children that become separate loadable chunks.

```
webpack approach:    module.addBlock(new AsyncDependenciesBlock(dep))  →  async chunk
injection-loader:    import(/* webpackChunkName: "..." */ "./file")    →  async chunk

Different API, same output.
```

---

## 11. The Server Bundle: A Different Story

For the **server bundle**, the `addInclude` approach works correctly. The difference is in how the entry name is chosen.

### Server: Reusing the Existing Entry Name

```js
// Server bundle: reuse the existing entry name
let serverEntryName;
if (this.options.isServer && compilation.entries) {
  const first = compilation.entries.keys().next();
  serverEntryName = first.value;  // e.g., "server-bundle"
}

// All modules are added to the existing "server-bundle" entry
compilation.addInclude(context, dep, { name: serverEntryName }, callback);
```

Because `"server-bundle"` already exists, `addInclude` appends to its `includeDependencies`. No new entry or chunk is created. Combined with `LimitChunkCountPlugin({ maxChunks: 1 })`, everything merges into a single `server-bundle.js` with all modules sharing one module map and one runtime.

Result: all 40 client components get proper numeric module IDs in the server manifest.

### The Injection-Loader Gap on the Server

The injection-loader only runs for the **client** bundle (`isServer: false`). The server bundle never runs it, so client-only files (like `.client.tsx` startup files) are never added to the server module graph.

During manifest emission, the plugin walks the server bundle's module graph and finds most client components — the ones that are imported somewhere in the server entry's dependency tree. But a few files might not be imported by anything in the server graph. For those, the plugin creates **fallback manifest entries** with string-path IDs instead of numeric IDs:

```json
{
  "file:///app/startup/BlogPostClient.client.tsx": {
    "id": "./app/javascript/startup/BlogPostClient.client.tsx",
    "chunks": [596, "server-bundle.js"],
    "name": "*"
  }
}
```

A string-path ID like `"./app/javascript/startup/BlogPostClient.client.tsx"` is not a real module ID in the server bundle. If the SSR runtime ever tried to `__webpack_require__` this ID, it would fail. In practice this works today because these specific files are client-only hydration entry points that are never referenced during RSC rendering. But it is a latent bug — if any RSC component ever imported one of these files, the SSR would crash.

---

## 12. The Ideal Hybrid Solution

The best approach combines both techniques:

| Bundle | Technique | Why |
|--------|-----------|-----|
| **Client** | Injection-loader | Creates proper async chunks that register with the shared runtime. Hydration works. Shared dependencies are deduplicated. |
| **Server** | `addInclude` with existing entry name | All modules get proper numeric IDs. No fallback entries needed. Works because the server bundle uses a single merged chunk (via LimitChunkCountPlugin), so the IIFE problem doesn't apply. |

### Implementation Sketch

```js
// Phase 1: FS-walk (both bundles)
compiler.hooks.beforeCompile.tapAsync('RSCPlugin', (params, callback) => {
  discoveredClientFiles = walkAndFind(compiler.context);

  // Only set injection state for client bundles
  if (!this.options.isServer) {
    setInjectionState(discoveredClientFiles, this.chunkName);
  }
  callback();
});

// Phase 2a: Client bundle — injection-loader (during make)
if (!this.options.isServer) {
  compiler.options.module.rules.push({
    test: (resource) => resource === clientRuntimePath,
    enforce: 'pre',
    use: [{ loader: require.resolve('./injection-loader.js') }],
  });
}

// Phase 2b: Server bundle — addInclude with existing entry (during finishMake)
if (this.options.isServer) {
  compiler.hooks.finishMake.tapAsync('RSCPlugin', (compilation, callback) => {
    const serverEntryName = compilation.entries.keys().next().value;

    let pending = discoveredClientFiles.length;
    for (const file of discoveredClientFiles) {
      const dep = EntryPlugin.createDependency(file, { name: serverEntryName });
      compilation.addInclude(context, dep, { name: serverEntryName }, (err, mod) => {
        if (mod) {
          const runtime = compilation.entries.get(serverEntryName)
            ?.options?.runtime ?? serverEntryName;
          compilation.moduleGraph.getExportsInfo(mod)
            .setUsedInUnknownWay(runtime);
        }
        if (--pending === 0) callback();
      });
    }
  });
}
```

This gives:
- **Client manifest**: all numeric IDs, all chunks are async (loadable by Flight runtime)
- **Server manifest**: all numeric IDs, no fallback entries
- **Hydration**: works correctly in production
- **Bundle size**: no duplicated shared dependencies
- **Build time**: no penalty (injection-loader adds ~0ms; addInclude for server is unchanged)

---

## 13. Production Build Evidence

All evidence below is from production builds (`NODE_ENV=production --mode production`) of the same application (localhub-demo with rspack 2.0.4).

### Client chunk format

**addInclude approach** — client chunks are standalone IIFEs:
```js
// client0-613ac275.js
(() => {
  "use strict";
  var e = {
    72553(e, t) { /* React JSX runtime — DUPLICATED */ },
    10514(e, t) { /* React core — DUPLICATED */ },
    52385(e, t, r) { /* BlogPostClient */ },
    31938(e, t, r) { /* RelatedPosts */ },
  };
  var t = {};
  function r(o) { /* private __webpack_require__ */ }
  r.d = ...;  r.o = ...;  r.r = ...;
})();
```

**Injection-loader approach** — client chunks register with shared runtime:
```js
// client0-eb751674.chunk.js
"use strict";
(self.rspackChunklocalhub_demo = self.rspackChunklocalhub_demo || []).push([
  [3635],
  {
    52385(r, e, t) { /* BlogPostClient — React loaded via shared t(62061) */ },
    31938(r, e, t) { /* RelatedPosts */ },
  }
]);
```

### Server manifest module IDs

**addInclude approach** — all 40 entries have numeric IDs:
```
Total entries: 40, String IDs: 0, Numeric IDs: 40
```

**Injection-loader approach** — 36 numeric + 4 string-path fallbacks:
```
Total entries: 40, String IDs: 4, Numeric IDs: 36
String IDs: BlogPostClient.client.tsx, ProductPageClient.client.tsx,
            ProductSearchClient.client.tsx, RestaurantDetailClient.client.tsx
```

### Build output size

| | addInclude | injection-loader |
|---|---|---|
| Total JS output | 11 MB | 8 MB |
| 39 client chunk files | 336 KB | 220 KB |
| Build time (3 bundles) | 4.89s | 4.43s |
| Entrypoints with own IIFE runtime | 22 | 0 |

### Hydration result

| | addInclude | injection-loader |
|---|---|---|
| Flight chunk loading | Broken (modules trapped in IIFEs) | Works (modules in shared map) |
| Client interactivity | Broken (buttons unresponsive) | Works (all buttons functional) |
| SSR rendering | Works (numeric server IDs) | Works (fallback entries unused) |

---

## Glossary

| Term | Definition |
|------|-----------|
| **IIFE** | Immediately Invoked Function Expression — `(() => { ... })()`. Creates a private scope. |
| **Module map** | A JavaScript object mapping numeric IDs to module factory functions. |
| **Runtime** | The bundler-generated code that loads modules by ID and manages chunk loading. |
| **Entry chunk** | A chunk loaded via `<script>` tag. Contains its own runtime (unless `runtimeChunk: 'single'`). |
| **Async chunk** | A chunk loaded on demand. Registers modules with the shared runtime via `rspackChunk.push()`. |
| **`addInclude`** | Bundler API to add a module to an entry's dependencies during compilation. |
| **Loader** | A function that transforms source code before the bundler processes it. |
| **Flight runtime** | React's client-side RSC runtime that loads client component chunks and hydrates them. |
| **Hydration** | The process where React attaches event handlers to server-rendered HTML, making it interactive. |
| **Manifest** | A JSON file mapping component file paths to their module IDs and chunk locations. |
| **`setUsedInUnknownWay`** | Bundler API that marks a module's exports as "used" to prevent tree-shaking and name mangling. |
| **`runtimeChunk: 'single'`** | Configuration that extracts the runtime into a shared chunk instead of duplicating it per entry. |
| **`LimitChunkCountPlugin`** | Plugin that merges chunks until the total count is at or below `maxChunks`. |
| **`splitChunks`** | Optimization that extracts shared modules (like React) into common chunks to avoid duplication. |
| **`finishMake`** | Compiler hook that fires after all entry modules are built but before the seal (optimization) phase. |
