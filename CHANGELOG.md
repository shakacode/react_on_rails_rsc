# Changelog

All notable changes to this package will be documented in this file.

## [Unreleased]

### Added
- Added opt-in client-reference diagnostics that emit RSC client reference JS/CSS asset files, byte sizes, and de-duplicated total byte counts for static island performance audits. ([#144])

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

[Unreleased]: https://github.com/shakacode/react_on_rails_rsc/compare/19.2.0...HEAD
[19.2.0]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5...19.2.0
[19.0.5]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.4...19.0.5

[#120]: https://github.com/shakacode/react_on_rails_rsc/pull/120
[#144]: https://github.com/shakacode/react_on_rails_rsc/pull/144
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
