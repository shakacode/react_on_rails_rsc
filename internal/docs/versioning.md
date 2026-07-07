# Versioning Policy

This package publishes the React Server Components integration used by React on
Rails Pro. Its version line must tell maintainers which React runtime line it
ships or requires, not just which package code changed.

The release mechanics live in [releasing.md](releasing.md). Issue
[#68](https://github.com/shakacode/react_on_rails_rsc/issues/68) tracks the
release-artifact and dist-tag cleanup that keeps npm, git tags, and GitHub
releases aligned with this policy.

## Version Lines

- The package `major.minor` tracks the React runtime `major.minor` line.
- Package patch versions and prereleases are package-level releases within that
  runtime line.
- Do not move a package line to a different React runtime minor without opening
  a new package minor line.

Examples:

- `19.0.x` is the package line for the React 19.0 runtime line. Package
  releases in this line are built against a React 19.0 runtime, whether the
  runtime comes from vendored artifacts or stock npm under the current
  runtime-sourcing plan in [eliminate-react-fork.md](eliminate-react-fork.md).
- `19.2.x` is the package line for the React 19.2 runtime line. React 19.2 work
  should not be published as a `19.0.x` package, even when the package API is
  otherwise unchanged.

## Peer Dependencies

Each runtime line owns its peer dependency policy:

- Root `react` and `react-dom` peers should be caret ranges that include the
  packaged `react-server-dom-webpack` runtime version. For example, a root peer
  of `^19.0.4` covers a packaged `19.0.7` runtime because the range minimum is
  in the same major line and is not higher than the packaged runtime.
- The root `react-server-dom-webpack` dependency should stay bounded to the
  package runtime minor, such as `~19.2.7`, so a 19.2 package line cannot float
  to a later Flight runtime minor without a new package minor line.
- The packaged runtime's own `react` and `react-dom` peers should match its
  exact version as `^<runtimeVersion>`.
- `scripts/verify-release.sh` enforces both contracts: root peer ranges must
  include the embedded runtime version, and packaged-runtime peers must match it
  exactly. Do not publish when the verifier reports a mismatch.
- Lowering a root peer minimum, advertising a new React minor line, or broadening
  the supported peer contract needs explicit matrix and downstream evidence in
  the release PR before `latest` is promoted.
- `webpack`, `@rspack/core`, and other bundler peers are compatibility
  contracts for the plugin layer. Keep them tied to tested bundler behavior
  rather than to the React runtime version alone. When consumers can use only
  one bundler integration, declare the bundler-specific peer as optional and
  pair every advertised major range with an explicit compatibility-matrix lane.

When a newer runtime line becomes `latest`, older runtime lines enter
maintenance mode:

- No new feature work or broad compatibility expansion should land on the older
  line.
- Publish older-line patches only for security fixes, severe regressions,
  release-artifact repairs, or downstream React on Rails support obligations.
- The older line is supported only while React on Rails Pro still needs that
  runtime line, unless maintainers announce a longer support window in
  `CHANGELOG.md` or the release notes.

> [!WARNING]
> Do not publish an older-line final with the default `yarn release` flow after
> a newer runtime line owns `latest`. The current release script assigns
> `latest` to every final release. Maintainers must first add release-script
> support for a non-`latest` maintenance dist-tag, tracked by
> [#68](https://github.com/shakacode/react_on_rails_rsc/issues/68), or use an
> explicitly reviewed procedure that preserves `latest` on the newer line.
> Document that procedure in the release PR and get second-maintainer approval
> before merging it.

## Prereleases and Dist Tags

Prereleases validate a runtime line without moving production consumers by
default:

- Publish release candidates as `X.Y.Z-rc.N`.
- Prereleases for the active runtime line go to the npm `next` dist-tag only.
  If two runtime lines have active release candidates at the same time, keep
  `next` on the newest active line and use an explicitly reviewed per-line tag,
  such as `next-19.0`, for maintenance-line candidates. Creating a custom
  dist-tag, for example `npm dist-tag add react-on-rails-rsc@<version>
  next-19.0`, is not handled by `yarn release` yet; track the operational
  procedure through
  [#68](https://github.com/shakacode/react_on_rails_rsc/issues/68).
- Do not use an npm `rc` dist-tag string for this package. That is separate
  from the `-rc.N` version suffix. If an npm `rc` dist-tag exists, treat it as
  stale release metadata and remove it with
  `npm dist-tag rm react-on-rails-rsc rc` through maintainer-owned release ops.
- Move npm `latest` only for a final release from `main`, after the downstream
  React on Rails gate has passed for the candidate.
- Verify release artifact parity after publishing: npm package version, npm
  dist-tags, unprefixed git tag, GitHub release, and changelog section should
  all describe the same version.

See [releasing.md](releasing.md) for the operational checklist and
[#68](https://github.com/shakacode/react_on_rails_rsc/issues/68) for the
pending release-hygiene cleanup.

## Runtime Strategy

Versioning is independent of how the runtime is sourced. The package line still
tracks the React runtime line whether the runtime comes from local patch-built
artifacts or from stock `react-server-dom-webpack`.

The active migration plan documented in
[eliminate-react-fork.md](eliminate-react-fork.md) is to use the stock
`react-server-dom-webpack` npm runtime (Option 5, selected GO by
[#55](https://github.com/shakacode/react_on_rails_rsc/issues/55)), gated on the
[#60](https://github.com/shakacode/react_on_rails_rsc/issues/60) migration
checklist. Patch files remain the documented fallback if any migration gate
fails.

Use these rules when the runtime strategy changes:

- For patch-built artifacts, the package line tracks the upstream React tag used
  to build the runtime. Local patch changes within the same React runtime line
  are package patch or prerelease changes, not a reason to reuse the wrong
  package minor.
- For a stock npm runtime, the package line tracks the stock runtime dependency
  line. Dependency and peer ranges must be no broader than the tested runtime,
  export-condition, bundler-global, and downstream compatibility evidence.
- If stock runtime validation fails and the project falls back to patch files,
  keep the same package runtime-line rule. The fallback changes how the runtime
  is produced, not which React line the package version represents.
