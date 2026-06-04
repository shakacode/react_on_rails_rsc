# Releasing react-on-rails-rsc

This project uses a changelog-driven release workflow. The target version is
read from `CHANGELOG.md`; do not pass a version to the release script. Update
the changelog first, merge that change to `main`, then run the release script.

Tags in this repository do not use a `v` prefix. For example, the rc.6 tag is
`19.0.5-rc.6`, not `v19.0.5-rc.6`.

## Prerequisites

For an actual release:

1. `npm whoami` succeeds for an npm account that can publish `react-on-rails-rsc`.
2. `gh auth status` succeeds for a GitHub account that can create releases.
3. The working tree is clean and the current branch is `main`.
4. `CHANGELOG.md` has a top release header for the version being published.

## Release Process

### 1. Update The Changelog

Use the local Claude Code command:

```text
/update-changelog
```

For a release candidate or explicit version, update `CHANGELOG.md` so the first
release header after the intro is the target version:

```markdown
## [19.0.5-rc.6] - 2026-06-04
```

The changelog compare links at the bottom should also use unprefixed tags:

```markdown
[19.0.5-rc.6]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.5...19.0.5-rc.6
```

Review and merge the changelog/version PR before publishing.

### 2. Run A Dry Run

From `main`:

```bash
yarn release:dry-run
```

The dry run verifies the release version, npm/GitHub auth where available,
package publish state, tests, build, and `npm pack --dry-run`.

### 3. Publish

```bash
yarn release
```

The script will:

1. Read the target version from the first `## [X.Y.Z]` header in `CHANGELOG.md`.
2. Verify that `package.json` is not ahead of the changelog version.
3. Stop if the release tag already exists or the npm version is already published.
4. Publish prereleases such as `19.0.5-rc.6` with the npm `next` dist-tag.
5. Run `yarn test`, `yarn run build`, and `npm pack --dry-run`.
6. Run `release-it` to commit any needed version bump, tag, and publish to npm.
7. Create a GitHub release from the matching `CHANGELOG.md` section.

### 4. Verify

- npm: https://www.npmjs.com/package/react-on-rails-rsc
- GitHub releases: https://github.com/shakacode/react_on_rails_rsc/releases

For an rc release, confirm npm uses the `next` dist-tag:

```bash
npm view react-on-rails-rsc dist-tags --json
```

## Current rc.6 Follow-Up

After `19.0.5-rc.6` is published, update the downstream
`shakacode/react_on_rails` rollout PR to depend on `react-on-rails-rsc@19.0.5-rc.6`
directly and remove the temporary `19.0.5-rc.5` patch package entry.

## Troubleshooting

**npm cache is unwritable:**

The release script defaults npm cache to a temp directory. To override:

```bash
NPM_CONFIG_CACHE=/private/tmp/react-on-rails-rsc-npm-cache yarn release:dry-run
```

**Version already exists on npm or as a git tag:**

Choose a new version, update `CHANGELOG.md` and `package.json`, then rerun the
release.

**npm publish failed after a tag was created:**

Delete the local and remote tag, fix the issue, then rerun:

```bash
git tag -d 19.0.5-rc.6
git push origin :19.0.5-rc.6
```

**GitHub release failed after npm publish:**

Create it manually from the changelog notes:

```bash
gh release create 19.0.5-rc.6 --title "19.0.5-rc.6" --prerelease --notes "..."
```
