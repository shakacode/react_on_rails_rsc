# Releasing react-on-rails-rsc

This project uses a changelog-driven release workflow. The target version is
read from `CHANGELOG.md`; do not pass a version to the release script. Update
the changelog first, merge that change to `main`, then run the release script.

Tags in this repository do not use a `v` prefix. For example, use
`X.Y.Z-rc.N`, not `vX.Y.Z-rc.N`.

## Dist-tag Policy

- Prereleases such as `X.Y.Z-rc.N` publish to the npm `next` dist-tag only.
- Do not use or restore an npm `rc` dist-tag for this package. If `rc` appears,
  treat it as stale release metadata and have a maintainer remove it after
  confirming no downstream automation depends on it.
- The npm `latest` dist-tag moves only on final releases from `main`, after the
  downstream React on Rails release gate has accepted the candidate.

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
## [X.Y.Z-rc.N] - YYYY-MM-DD
```

The changelog compare links at the bottom should also use unprefixed tags:

```markdown
[X.Y.Z-rc.N]: https://github.com/shakacode/react_on_rails_rsc/compare/<previous-tag>...X.Y.Z-rc.N
```

Review and merge the changelog/version PR before publishing.

### 2. Run A Dry Run

From `main`:

```bash
yarn release:dry-run
```

The dry run verifies the release version, npm/GitHub auth where available,
package publish state, tests, build, and `npm pack --dry-run`.

Use this dry run as the local fallback whenever you need to validate release
readiness without publishing. In dry-run mode, missing npm or GitHub auth is a
warning instead of a release blocker, and no npm publish, git tag, tag push, or
GitHub release is created.

### 3. Publish

```bash
yarn release
```

The script will:

1. Read the target version from the first `## [X.Y.Z]` header in `CHANGELOG.md`.
2. Verify that `package.json` is not ahead of the changelog version.
3. Stop if the release tag already exists or the npm version is already published.
4. Publish prereleases such as `X.Y.Z-rc.N` with the npm `next` dist-tag.
5. Run `yarn test`, `yarn run build`, and `npm pack --dry-run`.
6. Run `release-it` to commit any needed version bump, tag, and publish to npm.
7. Create a GitHub release from the matching `CHANGELOG.md` section.

### 4. Verify

#### Release Artifact Parity Checklist

After every release, verify artifact parity and record the results in the
release evidence. Replace `X.Y.Z` with the exact target version, including any
`-rc.N` prerelease suffix.

1. The npm package version exists:

   ```bash
   npm view react-on-rails-rsc@X.Y.Z version
   ```

2. The npm dist-tags match the policy above:

   ```bash
   npm view react-on-rails-rsc dist-tags --json
   ```

   For a prerelease, confirm the version is on `next`, `rc` is absent, and
   `latest` still points at the most recent final release. For a final release,
   confirm `latest` points at the new final version only after the downstream
   gate has passed.

3. The unprefixed git tag exists on origin:

   ```bash
   git ls-remote --tags origin refs/tags/X.Y.Z
   ```

4. The GitHub release exists and matches the same unprefixed tag:

   ```bash
   gh release view X.Y.Z
   ```

5. `CHANGELOG.md` contains the matching `## [X.Y.Z] - YYYY-MM-DD` section and
   the GitHub release notes were created from that section.
6. The packaged artifact is consistent with the release:

   ```bash
   npm pack react-on-rails-rsc@X.Y.Z --dry-run
   ```

Reference pages:

- npm: https://www.npmjs.com/package/react-on-rails-rsc
- GitHub releases: https://github.com/shakacode/react_on_rails_rsc/releases

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
git tag -d X.Y.Z
git push origin :X.Y.Z
```

**GitHub release failed after npm publish:**

Create it manually from the changelog notes:

```bash
gh release create X.Y.Z --title "X.Y.Z" --notes "..."
```

Add `--prerelease` for prerelease versions such as `X.Y.Z-rc.N`.
