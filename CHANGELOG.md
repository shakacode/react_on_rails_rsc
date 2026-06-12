# Changelog

All notable changes to this package will be documented in this file.

## [19.0.5-rc.8] - 2026-06-12

### Fixed
- Fixed Webpack client manifest generation to bind each client component to the chunk group created by its client-reference dependency, avoiding cross-reference chunk over-preloads while preserving entries for eager-imported client references. ([#54])

## [19.0.5-rc.7] - 2026-06-09

### Added
- Added Webpack client manifest coverage for excluding runtime-chunk CSS from the client manifest, retaining runtime-chunk CSS on the server manifest, and skipping hot-update CSS. ([#52])

### Fixed
- Fixed the Webpack client manifest CSS collection to exclude runtime-chunk CSS, matching the existing JS-chunk filtering, so shared runtime CSS no longer leaks into every client component's Flight stylesheet hints; the server manifest still retains runtime-chunk CSS for SSR coverage. ([#52])
- Fixed the Webpack client manifest CSS collection to skip `.hot-update.css` HMR files. ([#52])

## [19.0.5-rc.6] - 2026-06-04

### Added
- Added regression coverage for manifest CSS serialization on rendered client references and component-shaped client-reference export metadata.

### Fixed
- Fixed rendered client references with manifest CSS to emit request-scoped Flight stylesheet hints while preserving `react.client.reference` metadata and nested client-element prop shapes.
- Removed the process-global client manifest used by the earlier CSS wrapper path, avoiding cross-request manifest races.
- Fixed Webpack client manifest CSS collection to record CSS files regardless of JS/CSS file order, include `.mjs` chunks, normalize CSS hrefs when `publicPath` omits a trailing slash, and skip unresolved document-relative CSS hrefs when webpack uses the `publicPath: "auto"` sentinel.

## [19.0.5-rc.5] - 2026-06-03

### Changed
- Updated the vendored `react-server-dom-webpack` runtime to React 19.0.4 and aligned package peer dependencies with React 19.0.4.

### Fixed
- Replaced the `19.0.5-rc.4` runtime bundle that still reported React 19.0.3, so release candidates no longer include React Server Components runtime versions affected by CVE-2025-55183, CVE-2025-55184, and CVE-2025-67779.

## [19.0.5-rc.4] - 2026-06-02

### Added
- Added `RSCReferenceDiscoveryPlugin` and an export for emitting RSC graph-derived client reference metadata.
- Added coverage for graph-derived client-reference chunk discovery, CSS-first chunk ordering, default client-reference excludes, and duplicate package runtime detection.

### Changed
- Updated RSC loader/client-reference discovery to derive client references from the RSC graph and reuse directive parsing helpers.
- Refreshed the open RSC work status investigation for current issues, stale PRs, and release-order risks.

### Fixed
- Fixed default client reference discovery to skip dependency and generated asset directories such as `node_modules`, `vendor/bundle`, and `vendor/cache`.
- Fixed Webpack plugin runtime detection when package managers install multiple `react-on-rails-rsc` package instances for different peer dependency sets.
- Fixed `RSCRspackPlugin` so an unset `optimization.splitChunks.chunks` preserves the Rspack/Webpack default `async` behavior while still excluding generated RSC client-reference chunks from splitChunks extraction.

## [19.0.5-rc.3] - 2026-05-30

### Fixed
- Fixed `RSCRspackPlugin` so an unset `optimization.splitChunks.chunks` preserves the Rspack/Webpack default `async` behavior while still excluding generated RSC client-reference chunks from splitChunks extraction.

## [19.0.5-rc.2] - 2026-05-30

### Added
- Added `RSCRspackPlugin` and `RSCRspackLoader` exports for Rspack-native RSC client reference manifest generation.
- Added Rspack compatibility and plugin coverage for browser, client, server, directive parsing, dead-code, multiple-client, production-client, and symlinked-module scenarios.
- Added a plan for eliminating the React fork repository by moving RSC patches into this repo.

### Changed
- Updated RSC payload parsing to walk parsed models rather than relying on JSON revivers.
- Preserved server bundle exports while injecting client-reference metadata for Rspack builds.

### Fixed
- Fixed Rspack RSC client manifest generation, including symlinked client component references.
- Fixed `RSCRspackPlugin` server bundle injection and export preservation.
- Fixed the package `prepare`/`prepack` artifact check to look for emitted build outputs.
- Updated Claude workflow permissions for checks and statuses.

## [19.0.5-rc.1] - 2026-02-28

### Changed
- Released the first `19.0.5` release candidate.

[19.0.5-rc.8]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.7...19.0.5-rc.8
[19.0.5-rc.7]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.6...19.0.5-rc.7
[19.0.5-rc.6]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.5...19.0.5-rc.6
[19.0.5-rc.5]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.4...19.0.5-rc.5
[19.0.5-rc.4]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.3...19.0.5-rc.4
[19.0.5-rc.3]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.2...19.0.5-rc.3
[19.0.5-rc.2]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.1...19.0.5-rc.2
[19.0.5-rc.1]: https://github.com/shakacode/react_on_rails_rsc/releases/tag/19.0.5-rc.1

[#52]: https://github.com/shakacode/react_on_rails_rsc/pull/52
[#54]: https://github.com/shakacode/react_on_rails_rsc/pull/54
