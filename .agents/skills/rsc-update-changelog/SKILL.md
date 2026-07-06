---
name: rsc-update-changelog
description: Update react-on-rails-rsc CHANGELOG.md and optional package version headers for npm release or prerelease workflows.
argument-hint: '[classification-sweep BASE_REF..TARGET_REF|release|rc|beta|version]'
---

# RSC Update Changelog

Use this skill for `react-on-rails-rsc` changelog and release-heading work. The
package release is changelog-driven: `CHANGELOG.md` and `package.json` must name
the same target version before the GitHub Actions release workflow runs.

## Modes

- No argument: add user-visible entries under `## [Unreleased]`.
- `classification-sweep BASE_REF..TARGET_REF`: print a read-only table for every
  merged PR in the selected range before deciding which entries to add.
- `release`: add entries, stamp the next stable version header, and bump
  `package.json` to the same version.
- `rc` or `beta`: same as `release`, but stamp a prerelease version such as
  `19.0.5-rc.0` or `19.0.5-beta.0`.
- Explicit version: stamp exactly the provided semver version.

## RSC Release Rules

- Tags have no `v` prefix. Stable tags match `^[0-9]+\.[0-9]+\.[0-9]+$`;
  prerelease tags use hyphen suffixes such as `19.0.5-rc.7`.
- `scripts/release.sh` reads the top changelog heading and verifies
  `package.json` matches it through `yarn release:check`.
- The canonical release path is: update `CHANGELOG.md` and `package.json` in a
  PR, merge it, run `yarn release:check` from clean synced `main`, then dispatch
  the `Release package` workflow using the printed command.
- Add changelog entries only for user-visible package behavior: public API,
  exports, plugin/loader behavior, configuration, release behavior, security,
  performance, fixes, and breaking changes. Skip pure formatting, internal
  refactors, test-only changes, and docs-only fixes unless they correct behavior
  documentation.

## Classification Sweep

Set `BASE_REF` and `TARGET_REF`, then list squash-merged PRs in first-parent
order. Fall back to GitHub commit-to-PR lookup for commits without `(#NNN)` in
the title, and emit `UNKNOWN` for commits that still cannot be mapped.

Before writing, show the proposed classification table and ask the user to
confirm any ambiguous bump, missing PR mapping, or explicit version.
