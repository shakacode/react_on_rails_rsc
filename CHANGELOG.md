# Changelog

All notable changes to this package will be documented in this file.

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

[19.0.5]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.4...19.0.5

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
