# Changelog

All notable changes to this package will be documented in this file.

## [19.0.5-rc.3] - 2026-05-30

### Fixed
- Fixed default client reference discovery to skip dependency and generated asset directories such as `node_modules`, `vendor/bundle`, and `vendor/cache`.
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

[19.0.5-rc.3]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.2...19.0.5-rc.3
[19.0.5-rc.2]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.1...19.0.5-rc.2
[19.0.5-rc.1]: https://github.com/shakacode/react_on_rails_rsc/releases/tag/19.0.5-rc.1
