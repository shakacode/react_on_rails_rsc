# Releasing react-on-rails-rsc

This project uses a changelog-driven release workflow. The target version is
read from `CHANGELOG.md`, and `package.json` must match that version before the
release PR merges. Publish from the GitHub Actions release workflow; the local
`yarn release` path is maintainer-only fallback.

## Release Quickstart

1. Stamp the changelog and package version in one PR:

   ```text
   /update-changelog rc
   ```

   Use `/update-changelog release`, `/update-changelog beta`, or an explicit
   version such as `/update-changelog 19.2.1-rc.1` when that is the intended
   release type.

2. Review the stamped `CHANGELOG.md` and matching `package.json`, do a final
   changelog sweep for any PRs merged during the release window, then merge the
   PR to `main`.

3. From a clean, current `main` checkout, run the fast Actions preflight:

   ```bash
   git switch main
   git pull --ff-only origin main
   yarn release:check
   ```

4. For final non-prerelease versions, run the downstream React on Rails gate
   before dispatching the release so `latest` does not advance prematurely.

5. Run the `gh workflow run release.yml ...` command printed by
   `yarn release:check`.

Tags in this repository do not use a `v` prefix. For example, use
`X.Y.Z-rc.N`, not `vX.Y.Z-rc.N`.

## Dist-tag Policy

- Prereleases such as `X.Y.Z-rc.N` publish to the npm `next` dist-tag only.
- Do not use the npm `rc` dist-tag for this package. If `rc` appears,
  treat it as stale release metadata and have a maintainer remove it after
  confirming no downstream automation depends on it. First, record the current
  state so you can restore if needed:

    ```bash
    npm view react-on-rails-rsc dist-tags --json
    ```

    Then remove the stale tag:

    ```bash
    npm dist-tag rm react-on-rails-rsc rc
    ```

    If removal was premature, restore the previous version as an emergency
    rollback only, then remove `rc` again as soon as the emergency is resolved:

    ```bash
    npm dist-tag add react-on-rails-rsc@X.Y.Z-rc.N rc  # emergency rollback only
    # Resolve the issue, then:
    npm dist-tag rm react-on-rails-rsc rc
    ```

- The npm `latest` dist-tag moves only on final releases from `main`, after the
  downstream React on Rails release gate has accepted the candidate. That gate
  is the `Downstream E2E (React on Rails Pro dummy)` workflow in this repository
  and, when a React on Rails rollout branch is needed, the rollout PR in
  [shakacode/react_on_rails](https://github.com/shakacode/react_on_rails) that
  pins `react-on-rails-rsc@X.Y.Z-rc.N` and confirms the downstream app release
  path is ready. `latest` must not advance until the workflow is green for the
  candidate and any required rollout PR is merged to `main` in `react_on_rails`.

## Prerequisites

For an actual release:

1. The npm package has a trusted publisher configured for GitHub Actions:
   organization `shakacode`, repository `react_on_rails_rsc`, workflow filename
   `release.yml`, environment `release`, and allowed action `npm publish`.
2. The GitHub `release` environment exists with maintainer approval protection
   and deployment branches restricted to `main`.
3. No `NPM_TOKEN` or other long-lived npm publish token is required in GitHub
   secrets; publishing uses GitHub Actions OIDC.
4. `CHANGELOG.md` has a top release header for the version being published, and
   `package.json` has the same version.
5. The release workflow uses Node 24 and npm trusted publishing/provenance.
   See the npm docs for
   [trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
   [provenance](https://docs.npmjs.com/generating-provenance-statements/).

## Release Process

Before choosing a target version, confirm the runtime-line policy in
[versioning.md](versioning.md).

### 1. Update The Changelog And Package Version

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
[X.Y.Z-rc.N]: https://github.com/shakacode/react_on_rails_rsc/compare/PREVIOUS-TAG...X.Y.Z-rc.N
```

When stamping a version with `/update-changelog release`, `rc`, `beta`, or an
explicit version, bump `package.json` to the same version in the same PR. Plain
`/update-changelog` entries under `[Unreleased]` do not change `package.json`.

Review and merge the changelog/version PR before publishing.

### 2. Run The GitHub Actions Readiness Check

From `main`:

```bash
yarn release:check
```

This fast read-only check mirrors the GitHub Actions release metadata, tag, and
npm publish-state gates. It verifies:

1. The top `CHANGELOG.md` release header is valid semver and has release notes.
2. `package.json` has the same version.
3. The unprefixed git tag does not exist locally or on `origin`.
4. `react-on-rails-rsc@X.Y.Z` is not already published to npm.
5. The local checkout is on clean, synced `main`.

On success, it prints the exact dispatch command:

```bash
gh workflow run release.yml --ref main -f version=X.Y.Z -f confirm_publish=publish
```

This is distinct from `yarn release:dry-run`, which drives the heavier local
release-it fallback path. Use `release:dry-run` only when the GitHub Actions path
is blocked or a maintainer needs to debug the local fallback without publishing.

### 3. Run The Downstream React On Rails Gate

Before promoting a candidate to `latest`, dispatch `Downstream E2E (React on
Rails Pro dummy)` from GitHub Actions. Use these inputs:

1. `rsc_ref`: the `react_on_rails_rsc` candidate ref to test. Use the release
   candidate tag, release branch, or exact SHA.
2. `react_on_rails_ref`: the downstream React on Rails ref to test. Use `main`
   by default, or the rollout PR branch when the downstream package pin is being
   changed there.

The workflow builds and packs this package, installs the tarball into the
downstream `shakacode/react_on_rails` checkout, builds the Pro dummy app, starts
the Rails server and Pro node renderer, and runs the maintained RSC Playwright
subset:

- `e2e-tests/rsc_echo_props.spec.ts`: verifies server-rendered RSC props with
  special characters while blocking client fallback payload requests, so SSR
  serialization failures cannot be masked.
- `e2e-tests/rsc_route_ssr_false.spec.ts`: verifies `RSCRoute ssr={false}`
  payload fetching, lazy client roots, streamed roots, and that a normal
  client-rendered page does not load the RSC fetch runtime.

The subset intentionally matches the downstream dummy app's `e2e-test:rsc`
script. Broader Playwright specs such as streaming, refetch stress, async props,
and JSON parse race coverage remain downstream React on Rails responsibilities;
they exercise Pro renderer, Redis, or app-level behavior that is useful but not
specific to the `react-on-rails-rsc` package boundary.

For local maintainer debugging, run the same gate from this repository:

```bash
yarn test:e2e:downstream -- --react-on-rails-ref main
```

The script also accepts `--react-on-rails-dir PATH` for testing an existing
downstream checkout or rollout branch.

### 4. Publish From GitHub Actions

After `yarn release:check` passes, open GitHub Actions and run `Release package`
from the `main` branch, or run the `gh workflow run release.yml ...` command
printed by the check.

Use these `workflow_dispatch` inputs:

1. `version`: the exact version from the top `CHANGELOG.md` release header.
2. `confirm_publish`: `publish`.

The workflow will:

1. Require the protected GitHub `release` environment before publishing.
2. Verify that the dispatch ref is `main`.
3. Verify that `CHANGELOG.md` and `package.json` contain the same version.
4. Stop if the unprefixed git tag already exists or the npm version is already
   published.
5. Run `yarn build`.
6. Run `yarn test`.
7. Run `yarn verify:artifacts`.
8. Publish with npm trusted publishing and provenance:

   ```bash
   npm publish --ignore-scripts --provenance --access public --tag <next-or-latest>
   ```

9. Push the unprefixed annotated git tag.
10. Create the GitHub release from the matching `CHANGELOG.md` section.
11. Verify the npm package, npm dist-tags, and GitHub release.

Prereleases such as `X.Y.Z-rc.N` publish with the npm `next` dist-tag. Final
versions publish with `latest`; dispatch a final release only after the
downstream React on Rails release gate has accepted the candidate.

### 5. Maintainer-Only Local Fallback

Use the local publish path only if the GitHub Actions release path is blocked
and a maintainer explicitly chooses to publish from a trusted workstation:

```bash
yarn release:dry-run
```

```bash
yarn verify:artifacts
```

```bash
yarn release
```

The script will:

1. Read the target version from the first `## [X.Y.Z]` header in `CHANGELOG.md`.
2. Verify that `package.json` is not ahead of the changelog version; when using
   the canonical Actions path, `package.json` should already match.
3. Stop if the release tag already exists or the npm version is already published.
4. Publish prereleases such as `X.Y.Z-rc.N` with the npm `next` dist-tag.
5. Run `yarn test`, `yarn run build`, and `npm pack --dry-run`.
6. Run `release-it` to commit any needed version bump, tag, and publish to npm.
7. Create a GitHub release from the matching `CHANGELOG.md` section.

### 6. Verify

#### Release Artifact Parity Checklist

After every release, verify artifact parity and record the results in the
GitHub release description or a linked issue/PR comment. Replace `X.Y.Z` with
the exact target version, including any `-rc.N` prerelease suffix.

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

3. The unprefixed git tag exists on origin and points at the expected release
   commit:

   ```bash
   git ls-remote --tags origin refs/tags/X.Y.Z refs/tags/X.Y.Z^{}
   ```

   Expected: a `refs/tags/X.Y.Z` line. Annotated tags also show a separate
   dereferenced `refs/tags/X.Y.Z^{}` line with the release commit SHA. Cross-check
   the dereferenced SHA against the expected release commit and the GitHub
   release target. Empty output means the tag is absent and the parity check
   failed.

4. The GitHub release exists and matches the same unprefixed tag:

   ```bash
   gh release view X.Y.Z
   ```

   Confirm the output shows the correct tag (`X.Y.Z`), release candidates are
   marked as prereleases, and published releases are not drafts.

5. `CHANGELOG.md` contains the matching `## [X.Y.Z] - YYYY-MM-DD` section and
   the GitHub release notes were created from that section:

   For a final release:

   ```bash
   grep -F "## [X.Y.Z] - " CHANGELOG.md
   ```

   For a prerelease:

   ```bash
   grep -F "## [X.Y.Z-rc.N] - " CHANGELOG.md
   ```

6. The registry artifact metadata is consistent with the release:

   ```bash
   npm view react-on-rails-rsc@X.Y.Z dist
   ```

   Confirm the tarball URL is under `registry.npmjs.org`, and that `shasum`
   and `integrity` are present. If a local tarball was created with `npm pack`
   for release evidence, compare its hash to the registry metadata.

#### Promote latest after a final release

After checklist items 1-6 pass for a final release, the `Downstream E2E (React
on Rails Pro dummy)` workflow is green for the candidate, and any downstream
React on Rails rollout PR is merged to `main`, first confirm the current
dist-tag state:

```bash
npm view react-on-rails-rsc dist-tags --json
```

Verify `next` points at the expected release candidate and `latest` still points
at the previous final release. Then promote `latest` once:

```bash
npm dist-tag add react-on-rails-rsc@X.Y.Z latest
```

Then confirm `latest` points at `X.Y.Z` and no other unexpected tags changed:

```bash
npm view react-on-rails-rsc dist-tags --json
```

Do not run the `dist-tag add` command during a prerelease cycle.

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
git push origin --delete X.Y.Z
```

**npm publish succeeded but the tag push or GitHub release failed:**

Do not rerun the release workflow for the same version. The duplicate-publish
guard will stop it, and publishing the package has already completed. Create the
missing unprefixed tag from the release commit, push it, then create the GitHub
release from the matching changelog notes:

```bash
git tag -a X.Y.Z -m "Release X.Y.Z" <release-commit-sha>
git push origin X.Y.Z

# Final release
# Create /tmp/release-notes.md from the matching CHANGELOG.md section first.
gh release create X.Y.Z --title "X.Y.Z" --target <release-commit-sha> --notes-file /tmp/release-notes.md

# Release candidate
# Create /tmp/release-notes.md from the matching CHANGELOG.md section first.
gh release create X.Y.Z-rc.N --title "X.Y.Z-rc.N" --prerelease --target <release-commit-sha> --notes-file /tmp/release-notes.md
```
