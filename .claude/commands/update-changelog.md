# Update Changelog

You are helping update `CHANGELOG.md` for `react-on-rails-rsc`.

## Arguments

This command accepts an optional argument: `$ARGUMENTS`

- No argument (`/update-changelog`): add user-visible entries to an
  `[Unreleased]` section or to the current draft release section.
- Explicit version (`/update-changelog 19.0.5-rc.6`): add entries and stamp or
  update that exact version section.

This repository does not currently have a rake changelog task. Edit
`CHANGELOG.md` directly.

## Important Repo Conventions

- Package name: `react-on-rails-rsc`
- Tags do not use a `v` prefix. Use `19.0.5-rc.6`, not `v19.0.5-rc.6`.
- Version headers use this format:

  ```markdown
  ## [19.0.5-rc.6] - 2026-06-04
  ```

- Compare links also use unprefixed tags:

  ```markdown
  [19.0.5-rc.6]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.5...19.0.5-rc.6
  ```

## What To Include

Only add user-visible changes:

- New public exports or package capabilities
- Bug fixes
- Behavior changes in RSC rendering, manifests, webpack/rspack plugins, loaders,
  or package publishing
- Security fixes
- Compatibility changes affecting downstream `react_on_rails` or
  `react-on-rails-pro`

Do not add entries for formatting, lint-only changes, test-only changes, or
internal refactors unless they directly explain a user-visible fix.

## Section Order

Use these headings, omitting empty sections:

1. `### Added`
2. `### Changed`
3. `### Fixed`
4. `### Security`
5. `### Removed`

Keep wording concise and focused on observable behavior.

## Process

1. Fetch the latest main branch before comparing:

   ```bash
   git fetch origin main
   ```

2. Inspect recent tags and the current changelog:

   ```bash
   git tag --sort=-v:refname | head -20
   sed -n '1,220p' CHANGELOG.md
   ```

3. Find merged PRs or commits since the previous released tag:

   ```bash
   git log --oneline <previous-tag>..origin/main
   ```

4. Add or update the version section in `CHANGELOG.md`.

5. Update the compare links at the bottom:

   - `[new-version]` compares `<previous-tag>...<new-version>`
   - Older links remain below it

6. Verify formatting:

   ```bash
   sed -n '1,240p' CHANGELOG.md
   ```

7. For release readiness, run:

   ```bash
   yarn release:dry-run
   ```

## rc.6 Example

```markdown
## [19.0.5-rc.6] - 2026-06-04

### Added
- Added regression coverage for manifest CSS serialization on rendered client
  references and component-shaped client-reference export metadata.

### Fixed
- Fixed rendered client references with manifest CSS to emit request-scoped
  Flight stylesheet hints while preserving `react.client.reference` metadata.

[19.0.5-rc.6]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.5...19.0.5-rc.6
```
