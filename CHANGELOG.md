# Changelog

All notable changes to this package will be documented in this file.

## [19.3.0-rc.2] - 2026-09-08

### Changed
- Dropped the `es-module-lexer` runtime dependency. It was only used by the `cssWrapper` export scan, which now shares the client-reference transform's parser. ([#223])

### Fixed
- Fixed the opt-in `cssWrapper` option dropping the stylesheet hint for a plain child component shared by two or more client references, so enabling the flash-of-unstyled-content fix no longer caused a flash of unstyled content on the shared component. With `cssWrapper` on, the client manifest records a generated wrapper module as the client reference; the shared-child CSS recovery walked one dependency hop from that wrapper, which reached only the original client module and never its shared child, so the child's extracted stylesheet was emitted but never hinted. Both the webpack and Rspack plugins now start that walk from the original client module. Initial (entry-loaded) chunks stay excluded as before. ([#222])
- Fixed the `"use client"` export scan to treat Flow's ambient `declare class` / `declare var` / `declare function` declarations and TypeScript namespaces whose only members are type-only specifier exports (`export { type T }`) as erased, so the generated server stub no longer advertises client references for names that do not exist at runtime. ([#221])
- Fixed the `WebpackLoader` `parserPlugins` option to reject a malformed one-element tuple such as `['pipelineOperator']` with the loader's own message naming the option, instead of letting it fail inside the parser and surface as a "failed to parse the \"use client\" module" error that blames the source file. ([#221])
- Fixed the opt-in `cssWrapper` option dropping a `"use client"` module's named exports. The generated wrapper module is what the client manifest resolves to, and it replaces the module's export surface, but it enumerated exports with a parser that understands neither JSX nor TypeScript and silently fell back to wrapping only the default export. A component written as `export const Card = ({ title }) => <section className="card">{title}</section>` therefore resolved to `undefined` at render time even though the server-side client reference advertised it. The wrapper now enumerates exports with the same JSX- and TypeScript-aware pass the client-reference stub uses: `export * from` chains are resolved recursively through the bundler's own resolver instead of one level, reserved-word and arbitrary module namespace export names (`export { value as "weird name" }`) are aliased instead of emitting invalid syntax, and a parse failure, an unresolvable `export *` target, or a module with no runtime exports fails the build with an error naming the file. Affects both `RSCWebpackPlugin` and `RSCRspackPlugin`. ([#223])
- Fixed the opt-in `cssWrapper` option silently wrapping a name that two `export * from` targets each declare independently, including Flow enums and renamed local bindings (`export { Local as Renamed }`). ECMAScript module linking drops such an ambiguous name from the namespace object, so the generated wrapper exported `undefined` and the component failed to render even though the client-reference stub advertised it. Enumerating the exports now fails the build with an error naming the module, the ambiguous name, and both declaring files. A name re-exported from one shared origin through several paths, or shadowed by the module's own declaration, is unaffected. ([#223])

## [19.3.0-rc.1] - 2026-09-06

### Added
- Added a `parserPlugins` option to `react-on-rails-rsc/WebpackLoader` for enabling extra Babel parser plugins when enumerating `"use client"` exports, so proposal syntax the application build already accepts (for example the pipeline operator) does not fail the RSC bundle. ([#216])

### Changed
- A `"use client"` module with no runtime exports (type-only declarations, a CommonJS-style `exports.x = ...` body, or a TypeScript `export = X` assignment) now fails the build with an error naming the file, where the stock loader previously emitted an empty client-reference module and the component silently disappeared at render time. Give the module an ES module export or remove the directive. ([#216])

### Fixed
- Fixed `RSCRspackPlugin` to honor application `splitChunks` configuration for generated client-reference chunks, allowing shared JavaScript to be extracted once while preserving the complete sibling chunk metadata Flight needs for hydration. ([#213])
- Fixed `"use client"` modules silently compiling to an empty client-reference module when the loader could not parse them. The loader runs first in the React on Rails loader chain, so it sees raw JSX/TSX, and the stock `react-server-dom-webpack` node-loader enumerated exports with `acorn-loose`, which supports neither JSX nor TypeScript and never fails: on some JSX shapes it dropped the trailing `export default` and the component then vanished from the RSC payload with no build error. Export names are now collected with a JSX- and TypeScript-aware parser, TypeScript type-only exports are excluded, `export * from` targets are resolved through the bundler's own resolver, and a `"use client"` module with no runtime exports fails the build with an error naming the file instead of emitting an empty module. ([#216])

## [19.3.0-rc.0] - 2026-08-29

### Breaking Changes
- Raised the stock Flight runtime, React, and React DOM minimums from 19.2.7 to 19.2.8 so the packaged runtime and peer contract stay aligned. ([#203])

### Added
- Added an opt-in `cssWrapper` option to `RSCWebpackPlugin` and `RSCRspackPlugin` that prevents client-component CSS flash-of-unstyled-content by resolving each `"use client"` module to a generated wrapper which renders a native React 19 `<link rel="stylesheet" precedence>`, so the stylesheet blocks paint instead of arriving as a non-blocking `ReactDOM.preinit()` hint. Off by default. ([#196])

### Fixed
- Prevented `RSCRspackPlugin` browser bundles from requesting every discovered client-reference chunk at startup while preserving emitted chunks for Flight's on-demand loading. ([#207]) ([#210])

## [19.2.1] - 2026-07-14

### Added
- Added RSC server resource hint helpers for preloading assets, styles, scripts, fonts, and images, plus preconnect and DNS-prefetch support for already-resolved production asset URLs. The default `react-on-rails-rsc/server` fallback keeps failing fast at import time without the `react-server` condition while still publishing the expanded type surface. ([#143])
- Added opt-in client-reference diagnostics that emit RSC client reference JS/CSS asset files, byte sizes, and de-duplicated total byte counts for static island performance audits. Diagnostics-off builds skip CSS collection, and emitted CSS is scoped to the owning client-reference chunks. ([#144]) ([#152]) ([#166])
- Added an opt-in `entryClientReferencesFilename` option to `RSCWebpackPlugin` and `RSCRspackPlugin` that emits, for each entrypoint, the client references statically reachable from its module graph, keyed by the same `file://` hrefs as the client manifests. The client manifests themselves are unchanged; a downstream consumer can join the asset against the client manifest to scope per-route client-reference metadata, so static RSC pages stop needing a global `clientReferences: []` workaround. ([#176])

### Changed
- Changed the published npm license metadata to `SEE LICENSE IN LICENSE.md` and included the license file in the package. Starting with `19.2.1`, the package uses the React on Rails Pro v2.3 terms: Production Use requires an appropriate paid subscription or Complimentary OSS License, while the defined non-commercial, educational, and demo uses remain free. See [LICENSE.md](LICENSE.md) for the exact terms and the Meta notice that applies to the derived Webpack plugin portions. ([#193])
- Declared the optional `@rspack/core` peer range as Rspack 1.x or 2.x, added explicit Rspack 2.x compatibility coverage, and made Rspack 2 client-manifest chunk ordering deterministic while preserving the full sibling chunk set. ([#140]) ([#183])
- Stopped `RSCRspackPlugin` from injecting a no-op `"use client"` tagging loader into every first-party module, preserving Rspack incremental caching while keeping filesystem-based client-reference discovery. ([#167])

### Fixed
- Fixed Webpack string `clientReferences` to resolve relative to the compiler context and match symlink realpaths, and warned when `output.publicPath` values such as `"auto"` or functions cannot be serialized safely into the RSC manifest. ([#171]) ([#185])
- Fixed Rspack client manifests to emit stylesheet hints, normalize unserializable `output.publicPath: "auto"`, preserve `.mjs` chunk files, and match webpack split-runtime chunk metadata. ([#172])
- Fixed `RSCRspackPlugin` runtime injection state to be scoped by compiler, avoiding MultiCompiler and sequential-build cross-talk between rspack client/server builds with different client references or chunk names. ([#168])
- Fixed `RSCRspackPlugin` to install the generated client-reference `splitChunks` guard after Rspack applies option defaults, so default optimization configs keep generated client chunks self-contained. ([#165])
- Fixed watch rebuilds so rspack and webpack refresh client-reference runtime injections when `"use client"` files are added or removed without restarting the dev server. ([#164])
- Restored RSC stylesheet hints when a CSS-merging SplitChunks cache group moves a client reference's own CSS or a child module's CSS into a CSS-only split chunk. ([#151]) ([#184])
- Recovered RSC stylesheet hints for a plain (non-`"use client"`) child component's CSS when the child is shared by two or more client references and SplitChunks hoists it into a shared async chunk. The manifest now attaches the shared chunk's CSS to every referencing client reference instead of dropping it, fixing a flash of unstyled content on the shared component; initial (entry-loaded) chunks stay excluded to preserve the #108 render-blocking fix. ([#190])
- Fixed `RSCRspackPlugin` to skip manifest and diagnostics emission when the Flight client runtime is missing, matching the Webpack plugin's misconfiguration behavior instead of writing unusable assets. ([#176])

## [19.2.0] - 2026-06-28

### Breaking Changes
- Moved the package to the React 19.2 runtime line by depending on stock `react-server-dom-webpack@~19.2.7`, removing the published vendored Flight runtime, and raising the `react` and `react-dom` peer dependency floor to `^19.2.7`. ([#102])

  **Migration Guide:**

  1. Upgrade application `react` and `react-dom` dependencies to `19.2.7` or newer within the React 19.x line.
  2. Keep importing `react-on-rails-rsc/server.node`, `react-on-rails-rsc/client.node`, and `react-on-rails-rsc/client.browser` through this package's public exports; direct paths under `dist/react-server-dom-webpack/` are no longer shipped.
  3. Use the `react-on-rails-rsc/server` export for raw Flight runtime helpers such as `registerClientReference`.
  4. Plain Node processes that import `react-on-rails-rsc/server` with `react-server` but without the `webpack` condition no longer provide unbundled server-action decoding APIs; those APIs now fail with an explicit migration error because React 19.2 removed the public unbundled runtime.
  5. Keep RSC client and server bundles on the same React 19.2 runtime line; React 19.2 Flight stylesheet hint rows can use the bare `:HS[...]` format that older 19.0.x clients do not parse.

### Added
- Added a configurable client-build warning when a client reference appears in at least four client-reference chunk groups, helping surface cross-page JS/CSS duplication from chunk contamination. Set `chunkGroupWarningThreshold` to a positive number to tune the threshold, or to `0`/`false` to disable the warning. ([#120])

### Changed
- Set the 19.0.x package line to maintenance mode after the 19.2.x line becomes `latest`; future 19.0.x releases should be limited to security fixes, severe regressions, release-artifact repairs, or downstream React on Rails support obligations. ([#102])

### Fixed
- Fixed the Rspack RSC build skipping the client-references module map on the 19.2 line when `react-server-dom-webpack` resolves to a different install path than the plugin's own copy (duplicate installs, pnpm/yarn symlink stores, hoisted-vs-nested layouts). The plugin now recognizes the Flight client runtime by file-name suffix confirmed through a `react-server-dom-webpack` `package.json` walk instead of strict resolved-path equality, matching the Webpack plugin's duplicate-install handling, so the module map is emitted and Rspack-rendered RSC client content works again. ([#106])
- Preserved wrapper-layer RSC stylesheet hints for conditional `react-on-rails-rsc/server` Flight renderers, including edge/workerd, while using the stock React 19.2 runtime. ([#102])
- Scoped per-client-reference CSS to the chunk(s) that actually contain the reference instead of collecting it across the whole chunk group. Shared dependency chunks (`vendor`/`common`/styleguide) that the page entry already loads are no longer re-broadcast as a render-blocking `<link rel="stylesheet" precedence="rsc-css">` per client reference — the dominant FCP/LCP regression when a real page is converted to RSC — while a reference's own extracted CSS (including the entry chunk's CSS for an eagerly-imported component) and the `#52` runtime-chunk exclusion are preserved. ([#110])
- Recovered a client reference's own extracted CSS when `SplitChunks` + `MiniCssExtractPlugin` place it in a chunk separate from the one holding the reference's JS module (e.g. a cache group that matches the JS file but not its `.css` sibling). The plugin now follows each reference's direct `.css` imports to the chunk(s) carrying them, intersected with the reference's chunk group, so the `rsc-css` hint is still emitted for those styles. Only direct imports are followed, so the per-chunk scoping from `#110` continues not to re-broadcast shared dependency CSS. ([#113])

## [19.0.5] - 2026-06-13

### Added
- Added `RSCRspackPlugin` and `RSCRspackLoader` exports for Rspack-native RSC client reference manifest generation. ([#29])
- Added the `RSCReferenceDiscoveryPlugin` export and graph-derived Webpack client reference discovery so builds can emit client metadata from the actual RSC graph. ([#47])

### Changed
- Updated RSC payload parsing to walk parsed models after `JSON.parse`, reducing Flight chunk deserialization overhead while preserving RSC model revival behavior. ([#33])

### Fixed
- Fixed Webpack client manifest chunk and CSS collection to merge shared client-reference chunks, avoid runtime and hot-update CSS leaks, preserve CSS from CSS-first and `.mjs` chunk layouts, normalize emitted CSS hrefs, and bind each client component to its client-reference dependency chunk group. ([#23]) ([#35]) ([#52]) ([#54])
- Fixed RSC stylesheet hints for client components in deferred Suspense trees by serializing manifest CSS through request-scoped Flight payload links while preserving client-reference metadata. ([#35])
- Fixed Rspack client manifest generation to preserve server bundle exports, scope entries to explicit client references, support symlinked references, and keep the default `splitChunks.chunks` behavior at `async` when unset. ([#36]) ([#38]) ([#40])
- Fixed default client reference discovery to skip dependency and generated asset directories, and fixed Webpack runtime detection when package managers install multiple `react-on-rails-rsc` package instances for different peer dependency sets. ([#42]) ([#43])

### Security
- Updated the vendored `react-server-dom-webpack` runtime from React 19.0.3 to the React 19.0.7 security level, applying the React 19.0.4 fixes for CVE-2025-55183, CVE-2025-55184, and CVE-2025-67779 plus the React 19.0.7 reply-decoding denial-of-service fixes for CVE-2026-23869 (GHSA-479c-33wc-g2pg) and CVE-2026-23870 (GHSA-rv78-f8rc-xrxh). Note: the upstream CVE-2026-23869 fix changes the reply wire format for nested `FormData`, so client and server must both run the patched runtime shipped by this package. ([#48]) ([#86])

[Unreleased]: https://github.com/shakacode/react_on_rails_rsc/compare/19.3.0-rc.2...HEAD
[19.3.0-rc.2]: https://github.com/shakacode/react_on_rails_rsc/compare/19.3.0-rc.1...19.3.0-rc.2
[19.3.0-rc.1]: https://github.com/shakacode/react_on_rails_rsc/compare/19.3.0-rc.0...19.3.0-rc.1
[19.3.0-rc.0]: https://github.com/shakacode/react_on_rails_rsc/compare/19.2.1...19.3.0-rc.0
[19.2.1]: https://github.com/shakacode/react_on_rails_rsc/compare/19.2.0...19.2.1
[19.2.0]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5...19.2.0
[19.0.5]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.4...19.0.5

[#203]: https://github.com/shakacode/react_on_rails_rsc/pull/203
[#207]: https://github.com/shakacode/react_on_rails_rsc/pull/207
[#120]: https://github.com/shakacode/react_on_rails_rsc/pull/120
[#140]: https://github.com/shakacode/react_on_rails_rsc/pull/140
[#143]: https://github.com/shakacode/react_on_rails_rsc/pull/143
[#144]: https://github.com/shakacode/react_on_rails_rsc/pull/144
[#167]: https://github.com/shakacode/react_on_rails_rsc/pull/167
[#168]: https://github.com/shakacode/react_on_rails_rsc/pull/168
[#172]: https://github.com/shakacode/react_on_rails_rsc/pull/172
[#176]: https://github.com/shakacode/react_on_rails_rsc/pull/176
[#183]: https://github.com/shakacode/react_on_rails_rsc/pull/183
[#184]: https://github.com/shakacode/react_on_rails_rsc/pull/184
[#185]: https://github.com/shakacode/react_on_rails_rsc/pull/185
[#190]: https://github.com/shakacode/react_on_rails_rsc/pull/190
[#193]: https://github.com/shakacode/react_on_rails_rsc/pull/193
[#165]: https://github.com/shakacode/react_on_rails_rsc/pull/165
[#164]: https://github.com/shakacode/react_on_rails_rsc/pull/164
[#151]: https://github.com/shakacode/react_on_rails_rsc/pull/151
[#152]: https://github.com/shakacode/react_on_rails_rsc/pull/152
[#166]: https://github.com/shakacode/react_on_rails_rsc/pull/166
[#171]: https://github.com/shakacode/react_on_rails_rsc/pull/171
[#102]: https://github.com/shakacode/react_on_rails_rsc/pull/102
[#106]: https://github.com/shakacode/react_on_rails_rsc/pull/106
[#23]: https://github.com/shakacode/react_on_rails_rsc/pull/23
[#29]: https://github.com/shakacode/react_on_rails_rsc/pull/29
[#33]: https://github.com/shakacode/react_on_rails_rsc/pull/33
[#35]: https://github.com/shakacode/react_on_rails_rsc/pull/35
[#36]: https://github.com/shakacode/react_on_rails_rsc/pull/36
[#38]: https://github.com/shakacode/react_on_rails_rsc/pull/38
[#40]: https://github.com/shakacode/react_on_rails_rsc/pull/40
[#42]: https://github.com/shakacode/react_on_rails_rsc/pull/42
[#43]: https://github.com/shakacode/react_on_rails_rsc/pull/43
[#47]: https://github.com/shakacode/react_on_rails_rsc/pull/47
[#48]: https://github.com/shakacode/react_on_rails_rsc/pull/48
[#52]: https://github.com/shakacode/react_on_rails_rsc/pull/52
[#54]: https://github.com/shakacode/react_on_rails_rsc/pull/54
[#86]: https://github.com/shakacode/react_on_rails_rsc/pull/86
[#110]: https://github.com/shakacode/react_on_rails_rsc/pull/110
[#113]: https://github.com/shakacode/react_on_rails_rsc/pull/113
[#196]: https://github.com/shakacode/react_on_rails_rsc/pull/196
[#210]: https://github.com/shakacode/react_on_rails_rsc/pull/210
[#213]: https://github.com/shakacode/react_on_rails_rsc/pull/213
[#216]: https://github.com/shakacode/react_on_rails_rsc/pull/216
[#221]: https://github.com/shakacode/react_on_rails_rsc/pull/221
[#222]: https://github.com/shakacode/react_on_rails_rsc/pull/222
[#223]: https://github.com/shakacode/react_on_rails_rsc/pull/223
