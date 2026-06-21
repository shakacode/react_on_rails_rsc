---
name: update-changelog
description: Analyze merged PRs and update CHANGELOG.md, optionally stamping a release or prerelease (rc/beta) version header. Use before releases or when changelog entries are missing.
argument-hint: '[classification-sweep BASE_REF..TARGET_REF|release|rc|beta|version]'
---

# Update Changelog

You are helping to add an entry to the CHANGELOG.md file for the `react-on-rails-rsc` npm package.

## Arguments

This skill accepts an optional mode argument from the invocation text:

- **No argument** (`/update-changelog`): Add entries to `## [Unreleased]` without stamping a version header. Use this during development. (If the CHANGELOG has no `## [Unreleased]` section yet, add one at the top, immediately after the file's intro lines and above the newest version header.)
- **`release`** (`/update-changelog release`): Add entries, stamp a version header, and bump `package.json` to the same version. Auto-compute the next version based on changes (breaking -> major, added features -> minor, fixes -> patch). `yarn release:check` then reads this version from the top-most `## [x.y.z]` header and verifies it matches `package.json` before the GitHub Actions release.
- **`rc`** (`/update-changelog rc`): Same as `release`, but stamps an RC prerelease version (e.g., `19.0.5-rc.0`). Auto-increments the RC index if prior RCs exist for the same base version.
- **`beta`** (`/update-changelog beta`): Same as `rc`, but stamps a beta prerelease version (e.g., `19.0.5-beta.0`).
- **`classification-sweep`** (`/update-changelog classification-sweep BASE_REF..TARGET_REF`): Print a mechanical review table for every merged PR in the selected range before deciding which changelog entries to add. This read-only agent workflow runs git and GitHub API commands directly; it does not edit `CHANGELOG.md` and does not run `scripts/release.sh` or any version-stamping command.
- **Explicit version** (`/update-changelog 19.0.5-rc.10`): Add entries and stamp the exact version provided. Skips auto-computation — use this when you already know the target version. The version string must be valid semver (with an optional `-rc.N` or `-beta.N` prerelease suffix).

## When to Use This

This skill serves four use cases at different points in the release lifecycle:

**During development** -- Add entries to `## [Unreleased]` as PRs merge:

- Run `/update-changelog` to find merged PRs missing from the changelog
- Entries accumulate under `## [Unreleased]`

**Before each RC/release changelog edit** -- Sweep classifications mechanically:

- Run `/update-changelog classification-sweep BASE_REF..TARGET_REF` before adding entries or stamping a version
- Print a full table for every merged PR in the selected range, including `no-entry` rows, so reviewers can spot missed classifications
- Use the table to decide which `entry-needed` rows become changelog entries

**Before a release** -- Stamp a version header and prepare for release:

- Run `/update-changelog release` (or `rc`, `beta`, or an explicit version like `19.0.5-rc.10`) to add entries AND stamp the version header
- Bump `package.json` to the same version in the same PR
- The version is auto-computed from changes (breaking -> major, features -> minor, fixes -> patch) — skipped when an explicit version is provided
- The skill commits, pushes, and opens a PR — review and merge it to `main`
- Then run `yarn release:check` from clean synced `main` and dispatch the GitHub Actions `Release package` workflow with the command it prints
- The workflow publishes to npm with trusted publishing and creates a GitHub release from the matching changelog section

**After a release you forgot to update the changelog for** -- Catch-up mode:

- The skill can retroactively find commits between tags and add missing entries
- Ask the user whether to stamp a version header or add to `## [Unreleased]`

### Why changelog and package version come BEFORE the release

- The release is **changelog-driven**: the target version comes from the top-most `## [x.y.z]` header in CHANGELOG.md, and `package.json` must match that version before the release PR merges.
- The canonical GitHub Actions release workflow refuses to publish when `CHANGELOG.md` and `package.json` differ, the unprefixed tag already exists, or the npm version is already published.
- `yarn release:check` mirrors those fast metadata/tag/npm gates locally and prints the exact workflow dispatch command. The required sequence is: **update CHANGELOG.md and package.json -> merge that change to `main` -> run `yarn release:check` from clean synced `main` -> dispatch `Release package`.**
- The workflow builds the GitHub release notes from the changelog section matching the target version — no separate sync step is needed.
- If no changelog section matches the target version, the release workflow fails, so the section must exist first.
- A premature version header (if a release fails) is harmless -- you'll release eventually.

## Auto-Computing the Next Version

When stamping a version header (`release`, `rc`, or `beta`), compute the next version as follows:

1. **Find the latest stable version tag** using semver sort (tags in this repo have NO `v` prefix — they match the changelog headers exactly, e.g. `19.0.5-rc.7`):

   ```bash
   git tag --sort=-v:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1
   ```

2. **Determine bump type from changelog content**:
   - If changes include `### Breaking Changes` (or a documented breaking change) -> **major** bump
   - If changes include `### Added` -> **minor** bump
   - If changes only include `### Fixed`, `### Changed`, `### Removed`, `### Security`, or `### Deprecated` -> **patch** bump

3. **Compute the version**:
   - For `release`: Apply the bump to the latest stable tag (e.g., `19.0.4` + patch -> `19.0.5`)
   - For `rc`: Apply the bump, then find the next RC index based **only on git tags** (e.g., if a `19.0.5-rc.0` tag exists -> `19.0.5-rc.1`). **Do NOT use changelog headers** to determine the next index — a version header in the changelog is a draft that may not have been released yet. Only git tags represent shipped versions.
   - For `beta`: Same as RC but with a `-beta.N` suffix

4. **Verify**: Check that the computed version is newer than ALL existing tags (stable and prerelease). If not, ask the user what to do.

5. **Show the computed version to the user and ask for confirmation** before stamping the header. If the bump type is ambiguous (e.g., changes could reasonably be classified as patch vs minor, or the changelog headings don't clearly signal the bump level), explain your reasoning for the suggested bump and ask the user to confirm or override before proceeding.

## Critical Requirements

1. **User-visible changes only**: Only add changelog entries for user-visible changes:
   - New features
   - Bug fixes
   - Breaking changes
   - Deprecations
   - Performance improvements
   - Security fixes
   - Changes to the package's public API, exports, plugin/loader behavior, or configuration options

2. **Do NOT add entries for**:
   - Linting fixes
   - Code formatting
   - Internal refactoring
   - Test updates
   - Documentation fixes (unless they fix incorrect docs about behavior)
   - CI/CD changes

## Classification Sweep Mode

Use `classification-sweep` before every RC/release changelog edit, and whenever a prior changelog pass might have missed a merged PR. This is a mechanical coverage pass: it classifies every merged PR in the selected range, then humans review the classifications before entries are written.

### Exact PR-Listing Command

Set `BASE_REF` to the previous release tag or lower bound and `TARGET_REF` to the release tag, `origin/main`, or upper bound being audited. Then run this exact command to list merged PRs in first-parent order. It extracts PR numbers from squash titles, falls back to GitHub's commit-to-PR API for commits that lack `(#NNN)` in the title, and emits an explicit `UNKNOWN` row for any commit that still cannot be mapped.

```bash
BASE_REF="${BASE_REF:?set BASE_REF, e.g. 19.0.5-rc.6}"
TARGET_REF="${TARGET_REF:?set TARGET_REF, e.g. 19.0.5-rc.7 or origin/main}"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)" || {
  printf 'error: gh repo view failed; run: gh auth status\n' >&2
  exit 1
}
DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)" || {
  printf 'error: gh repo view failed; run: gh auth status\n' >&2
  exit 1
}

git log --first-parent --reverse --format='%H%x09%s' "${BASE_REF}..${TARGET_REF}" |
while IFS=$'\t' read -r sha subject; do
  pr_number=$(printf '%s\n' "$subject" | sed -nE 's/.*\(#([0-9]+)\)[[:space:]]*$/\1/p')
  if [ -n "$pr_number" ]; then
    printf '%s\t%s\t%s\n' "$pr_number" "$sha" "$subject"
  else
    mapped_rows=$(SHA="$sha" DEFAULT_BRANCH="$DEFAULT_BRANCH" gh api -H "Accept: application/vnd.github+json" \
      "repos/${REPO}/commits/${sha}/pulls" \
      --jq '.[] | select(.merged_at != null and .base.ref == env.DEFAULT_BRANCH) | [.number, env.SHA, .title] | @tsv' 2>&1)
    api_status=$?
    if [ "$api_status" -ne 0 ]; then
      printf 'warning: commit-to-PR API lookup failed for %s: %s\n' "$sha" "$mapped_rows" >&2
      printf 'UNKNOWN\t%s\t%s\n' "$sha" "$subject"
    elif [ -n "$mapped_rows" ]; then
      printf '%s\n' "$mapped_rows"
    else
      printf 'UNKNOWN\t%s\t%s\n' "$sha" "$subject"
    fi
  fi
done | awk -F '\t' '{ key = ($1 == "UNKNOWN" ? $1 FS $2 : $1); if (!seen[key]++) print }'
```

If any commit in the range cannot be mapped to a PR, the command prints an explicit `UNKNOWN` row for that commit. Carry that row into the full table with `Result` set to `UNKNOWN`, investigate it, and do not finish the sweep until the row is resolved to a merged PR classification or explicitly reported as a blocker. Do not silently drop it.

A sudden spike of `UNKNOWN` rows can indicate stale GitHub authentication, API rate limits, or a temporary API failure rather than genuinely unmapped commits. Run `gh auth status` and retry the PR-listing command when the UNKNOWN count looks suspicious.

The fallback makes one GitHub API call per commit whose subject lacks `(#NNN)`. Typical RC ranges complete quickly, but large ranges with many direct commits can hit rate limits. Direct version-bump commits, bot commits, and release-automation commits may be expected `UNKNOWN` rows; keep them in the table with `Result` set to `UNKNOWN`, choose `internal` or `release-process`, and explain that no PR-backed changelog entry exists.

### Required Sweep Output

Print the full Markdown table. No silent caps, no "top N", and no filtering to only likely changelog entries. Every row from the PR-listing command must appear, including `no-entry` rows.

```markdown
| PR   | Title                                          | Result       | Category         | Reason                                                                                          |
| ---- | ---------------------------------------------- | ------------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| #52  | Filter runtime-chunk CSS from client manifest  | entry-needed | product code     | Changes which CSS the Webpack client manifest emits, affecting Flight stylesheet hints.         |
| #53  | Stamp CHANGELOG and package version            | no-entry     | release-process  | Version/changelog stamping for a release; no product behavior change.                           |
```

Allowed `Result` values for mapped PRs are exactly:

- `entry-needed`
- `no-entry`

Use `UNKNOWN` only for unmapped commit rows emitted by the PR-listing command; resolve or report those rows before finishing.

Allowed `Category` values are exactly:

- `product code`
- `perf-reliability`
- `release-process`
- `internal`

Each row needs a one-line reason specific enough for review. Avoid generic reasons like "not user-visible" unless the row also says why.
Copy category values exactly as listed, including spaces, hyphens, and casing.

### Classification Rubric

- Use `entry-needed` for user-visible package behavior: public API/exports changes, webpack/rspack plugin and loader behavior, generated manifest output, configuration changes, peer-dependency/compatibility changes, breaking changes, security fixes, and performance or reliability changes users would care about.
- Use `entry-needed` for `perf-reliability` when the PR changes runtime performance, removes blocking work, improves recovery, or makes user-visible failures diagnosable.
- Use `no-entry` for docs-only, tests-only, formatting, lint, internal refactors, CI, benchmark harnesses, release automation, agent/process docs, and other contributor-only changes. Keep docs-only PRs as `entry-needed` only when they correct incorrect public behavior documentation; use Category `product code` for those.
- Categorize by the primary surface changed, not by the changelog section it might eventually use:
  - `product code`: the npm package's runtime, exports, public types, public config, plugin/loader behavior, or generated manifest output.
  - `perf-reliability`: runtime performance/reliability fixes, benchmark/regression systems, and failure classification. Category applies regardless of result. Use `entry-needed` when the change directly benefits users at runtime, such as removing blocking work from a build or render path. Use `no-entry` for internal benchmark harnesses or regression tooling that contributors use.
  - `release-process`: the release script, CI selection, dependency pins used only for releasing/testing, changelog mechanics, PR batch mechanics, agent skills, GitHub Actions, and maintainer workflow.
  - `internal`: docs/planning, tests, fixtures, refactors, cleanup, diagnostics for contributors, and non-user-facing maintenance.

### Reverts and Re-Runs

When a revert lands in the selected RC/release window, re-run the sweep or revisit affected classifications and changelog entries before stamping. Reverts can invalidate earlier `entry-needed` rows or require the original entry to be rewritten. If a revert lands after the PR it reverses, revisit that PR's classification and changelog entry instead of carrying the original entry forward unchanged.

## Formatting Requirements

### Entry Format

This repo's CHANGELOG.md follows the [Keep a Changelog](https://keepachangelog.com/) convention with **reference-style** PR links. Each changelog entry MUST follow this exact format:

```markdown
- Past-tense description of the user-visible change. ([#52])
```

**Important formatting rules**:

- Start with a dash and space: `- `
- Write a single past-tense sentence describing the change (no leading bold label, no author link).
- Reference the PR inline with a reference-style link in parentheses at the end: `([#52])` — note the `#` is part of the link label.
- End the sentence with a period before the `([#NN])` reference.
- For each PR referenced, add a matching link definition at the **bottom** of the file (see "Version Links"):

  ```markdown
  [#52]: https://github.com/shakacode/react_on_rails_rsc/pull/52
  ```

- A single entry may reference more than one PR by repeating the reference: `... ([#52]) ([#53])`.
- Multi-line detail can use indented sub-bullets under the entry.

### Breaking Changes Format

For breaking changes, add a `### Breaking Changes` subsection (it sorts first — see "Category Organization") and describe the change plus a migration guide:

```markdown
### Breaking Changes

- Renamed the exported `Foo` plugin option to `Bar`; update plugin configuration accordingly. ([#52])

  **Migration Guide:**

  1. Step one
  2. Step two
```

### Category Organization

Within a version section, organize entries under these `###` subsection headings **in the following order** (most critical first). These match the Keep a Changelog headings already used in this repo (`### Added`, `### Changed`, `### Fixed`, `### Removed`):

**Preferred section order:**

1. `### Breaking Changes` - Breaking changes with migration guides (FIRST - most critical for upgrading users)
2. `### Added` - New features
3. `### Changed` - Changes to existing functionality
4. `### Fixed` - Bug fixes
5. `### Deprecated` - Deprecation notices
6. `### Removed` - Removed features
7. `### Security` - Security-related changes

**Rationale:** Breaking changes come first because they are the most critical information for anyone upgrading. Users need to know immediately if their code will break before seeing what new features are available.

**Prefer the standard Keep a Changelog headings above.** Only introduce a custom heading when a change genuinely doesn't fit one of them.

**Only include section headings that have entries.**

### Version Stamping

When this command is invoked with `release`, `rc`, `beta`, or an explicit version (e.g., `19.0.5-rc.10`), stamp the version header manually after adding entries — there is no rake task in this repo. The release is driven entirely by the top-most `## [x.y.z]` header in CHANGELOG.md.

To stamp a version:

1. Compute the version per "Auto-Computing the Next Version" (or use the explicit version provided).
2. If a `## [Unreleased]` section exists, rename it to `## [<version>] - YYYY-MM-DD` (today's date), or insert a new `## [<version>] - YYYY-MM-DD` header above the previous newest version header and move the relevant entries beneath it.
3. Update `package.json` so its `version` equals `<version>`.
4. Update the reference links at the bottom of the file (see "Version Links").

Bump `package.json` to match the version you stamp, in the same PR. The local
`yarn release` fallback will see it already correct; the GitHub Actions release
path requires it. Plain `/update-changelog` with no version-stamping argument
does not touch `package.json`.

**When to use which path:**

- **`/update-changelog release` (this skill)**: Full automation -- analyzes commits, writes changelog entries, stamps the version header, and bumps `package.json` to match. Use before a release.
- **`/update-changelog` (this skill, no args)**: Adds entries to `## [Unreleased]` during development. Does not stamp a version header.

### Finding the Most Recent Version

To determine the most recent version:

1. **Check git tags** to find the latest released version. Tags in this repo have **no `v` prefix** — they match the changelog headers verbatim:

   ```bash
   git tag --sort=-v:refname | head -10
   ```

   This shows tags like `19.0.5-rc.7`, `19.0.5-rc.6`, etc.

2. **Check the CHANGELOG.md** for version headers (level-2 `##` headers, same string as the tag — no `v` prefix):
   - `## [19.0.5-rc.7] - 2026-06-09` (prerelease)
   - `## [19.0.4] - 2026-05-01` (stable)

3. **Use this regex pattern** to find version headers in the changelog:

   ```regex
   ^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}
   ```

4. **The first match** (below any `## [Unreleased]`) is the most recent version in the changelog.

**IMPORTANT**: Git tags and changelog headers use the **same** version string with **no `v` prefix** (e.g., tag `19.0.5-rc.7` <-> header `## [19.0.5-rc.7]`). Compare links at the bottom of the file also use the bare version (e.g., `.../compare/19.0.5-rc.6...19.0.5-rc.7`).

### Version Links

This repo collects two kinds of reference-style links at the **bottom** of CHANGELOG.md:

1. **Version compare links**, one per released version:

   ```markdown
   [19.0.5-rc.7]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.6...19.0.5-rc.7
   [19.0.5-rc.6]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.5...19.0.5-rc.6
   ```

   The first-ever tag uses a `releases/tag/<version>` link instead of a compare link:

   ```markdown
   [19.0.5-rc.1]: https://github.com/shakacode/react_on_rails_rsc/releases/tag/19.0.5-rc.1
   ```

2. **PR reference links**, one per `([#NN])` used in an entry:

   ```markdown
   [#52]: https://github.com/shakacode/react_on_rails_rsc/pull/52
   ```

When you add an entry, add its `[#NN]` link definition to the PR-links block at the bottom.

When you stamp a new version:

1. Insert the new version header **at the top**, above the previous newest version header:

   ```markdown
   ## [19.0.5-rc.8] - 2026-06-15
   ```

2. Add a new version compare link comparing the previous version to the new version (bare versions, no `v` prefix), keeping the version links in newest-first order.
3. If a `## [Unreleased]` section is in use, keep it above the newest version header.

## Process

### For Regular Changelog Updates

#### Step 1: Fetch and read current state

- **CRITICAL**: Run `git fetch origin main` to ensure you have the latest commits
- After fetching, use `origin/main` for all comparisons, NOT the local `main` branch
- Read the current CHANGELOG.md to understand the existing structure

#### Step 2: Reconcile tags with changelog sections (DO THIS FIRST)

**This step catches missing version sections and is the #1 source of errors when skipped.**

1. Get the latest git tag: `git tag --sort=-v:refname | head -5`
2. Get the most recent version header in CHANGELOG.md (the first `## [VERSION] - DATE`)
3. **Compare them.** If the latest git tag does NOT appear anywhere in the changelog version headers, there are tagged releases missing from the changelog. **Important**: Don't just compare against the _top_ changelog header — a version header may exist _above_ the latest tag if it was stamped as a draft before tagging. Check whether the tag's version appears in _any_ `## [X.Y.Z]` header. For example:
   - Latest tag: `19.0.5-rc.7`, and no `## [19.0.5-rc.7]` header exists anywhere in CHANGELOG.md
   - **Result: `19.0.5-rc.7` is missing and needs its own section**
   - But if `## [19.0.6-rc.0]` is the top header (a draft, not yet tagged) and `## [19.0.5-rc.7]` exists below it, then nothing is missing — the top header is simply a prerelease draft

4. For EACH missing tagged version (there may be multiple):
   a. Find commits in that tag vs the previous tag: `git log --oneline PREV_TAG..MISSING_TAG`
   b. Extract PR numbers and fetch details for user-visible changes
   c. Check which entries currently in `## [Unreleased]` (if present) actually belong to this tagged version (compare PR numbers against the commit list)
   d. **Create a new version section** immediately before the previous version section:

   ```markdown
   ## [19.0.5-rc.7] - 2026-06-09
   ```

   e. **Move** matching entries from `## [Unreleased]` into the new section
   f. **Add** any new entries for PRs in that tag that aren't in the changelog at all
   g. **Update reference links** at the bottom of the file (version compare links and any new `[#NN]` PR links)

5. Get the tag date with: `git log -1 --format="%Y-%m-%d" TAG_NAME`

#### Step 3: Add new entries for post-tag commits

1. Run `git log --oneline LATEST_TAG..origin/main` to find commits after the latest tag (LATEST_TAG is the most recent git tag, i.e., the same one identified in Step 2)
2. Extract PR numbers: `git log --oneline LATEST_TAG..origin/main | grep -oE "#[0-9]+" | sort -u`
3. If Step 2 found no missing tagged versions, verify no tag is ahead of main: `git log --oneline origin/main..LATEST_TAG` should be empty. If not, entries in "Unreleased" may belong to that tagged version — Step 2 should have caught this, so re-check.
4. For each PR number, check if it's already in CHANGELOG.md: `grep "#XXX" CHANGELOG.md`
5. For PRs not yet in the changelog:
   - Get PR details: `gh pr view NUMBER --json title,body,author --repo shakacode/react_on_rails_rsc`
   - **Never ask the user for PR details** - get them from git history or the GitHub API
   - Validate that the change is user-visible (per the criteria above). Skip CI, lint, refactoring, test-only changes.
   - Add the entry to `## [Unreleased]` (creating that section if needed) under the appropriate `###` subsection heading, and add the matching `[#NN]` PR link at the bottom.

#### Step 4: Stamp version header (only when a version mode or explicit version is given)

If the user passed `release`, `rc`, `beta`, or an explicit version string as an argument:

**For `release`, `rc`, or `beta` keywords:**

1. Auto-compute the next version per "Auto-Computing the Next Version" (prerelease index is determined solely from git tags, not changelog headers) and confirm it with the user.
2. Stamp the header: rename `## [Unreleased]` to `## [<version>] - YYYY-MM-DD`, or insert a new `## [<version>] - YYYY-MM-DD` header above the previous newest version header and move the relevant entries beneath it.
3. Update `package.json` so its `version` equals `<version>`.
4. Update the reference links at the bottom (add the version compare link; ensure all `[#NN]` PR links used by the new section are present).

**For an explicit version string** (e.g., `19.0.5-rc.10`):

1. Use the explicit version directly for the header (do not auto-compute).
2. Update `package.json` so its `version` equals the requested version.
3. **Verify** the stamped header, `package.json`, and compare link match the requested version.

If no argument was passed, skip this step -- entries stay in `## [Unreleased]`.

#### Step 5: Verify and finalize

1. **Verify formatting**:
   - Past-tense entry sentence ending in a period before the `([#NN])` reference
   - Reference-style PR link with a matching `[#NN]:` definition at the bottom
   - Consistent with existing entries
   - File ends with a newline character
   - **No duplicate section headings** (e.g., don't create two `### Fixed` sections — merge entries into the existing heading)
2. **Verify version sections are in order** (Unreleased -> newest tag -> older tags)
3. If in `release`/`rc`/`beta` mode or explicit-version mode, **verify `package.json` matches the stamped version**. If no argument was passed, verify `package.json` was not changed.
4. **Verify the reference links** at the bottom of the file are correct (version compare links use the bare version with no `v` prefix; every `([#NN])` has a matching `[#NN]:` definition)
5. **Show the user** a summary of what was done:
   - Which version sections were created
   - Whether `package.json` was updated or intentionally left untouched
   - Which entries were moved from Unreleased
   - Which new entries were added
   - Which PRs were skipped (and why)
6. If in `release`/`rc`/`beta` mode or explicit-version mode, **automatically commit, push, and open a PR**:
   - Verify the working tree only has `CHANGELOG.md` and `package.json` changes; if there are other uncommitted changes, warn the user and stop
   - Verify the current branch is `main` (`git branch --show-current`); if not, warn the user and stop
   - Create a feature branch (e.g., `changelog-19.0.5-rc.10`)
   - Stage only `CHANGELOG.md` and `package.json` (`git add CHANGELOG.md package.json`) and commit with message `Update CHANGELOG.md and package version for VERSION` (using the stamped version)
   - Push and open a PR with the changelog diff as the body
   - If the push or PR creation fails, the CHANGELOG is already stamped locally — fix the issue (e.g., authentication, branch protection), then run `git push -u origin <branch>` and `gh pr create` manually
   - Remind the user that, **after the PR merges to `main`**, the canonical release path is `yarn release:check` from clean synced `main`, followed by the `gh workflow run release.yml ...` command that the check prints. Use `yarn release:dry-run` only when debugging the maintainer-only local fallback path.

### For Prerelease Versions (RC and Beta)

When the user passes `rc` or `beta` as an argument:

1. **Find the latest tag** (stable or prerelease) using semver sort:

   ```bash
   git tag --sort=-v:refname | head -10
   ```

2. **Auto-compute the next prerelease version** using the process in "Auto-Computing the Next Version" above.

3. **Do NOT collapse prior prereleases.** Each RC/beta is a separately-tagged release published to npm (under the `next` dist-tag) — users need to see what changed between, for example, `rc.0` and `rc.1` (especially when diagnosing a regression in a specific RC). `scripts/release.sh` reads only the top-most `## [VERSION]` section for the GitHub release notes, so as long as each RC has its own section, its release notes stay focused. Instead:
   - Insert the new prerelease version section at the top, **above** any prior prerelease sections (preserves newest-first ordering)
   - Any entries already under `## [Unreleased]` belong to this prerelease — move them under the new header
   - Leave prior prerelease sections (e.g., `## [19.0.5-rc.0]`) untouched — keep their entries and their compare links at the bottom of the file
   - Add any new user-visible changes from commits since the last prerelease tag to the new section only
   - Add a new compare link at the bottom comparing the previous prerelease tag (or the last stable tag if this is the first RC) to the new prerelease tag
   - If a `## [Unreleased]` section is in use, keep it at the very top above the newest version header

**Resulting structure** after stamping `19.0.5-rc.1` (with `19.0.5-rc.0` already shipped on top of stable `19.0.4`):

```markdown
## [19.0.5-rc.1] - 2026-03-15

### Fixed

- Fixed a regression introduced in rc.0. ([#2500])

## [19.0.5-rc.0] - 2026-03-01

### Added

- Added a new export. ([#2490])

## [19.0.4] - 2026-02-15

...

[19.0.5-rc.1]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.5-rc.0...19.0.5-rc.1
[19.0.5-rc.0]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.4...19.0.5-rc.0
[19.0.4]: https://github.com/shakacode/react_on_rails_rsc/compare/19.0.3...19.0.4
[#2490]: https://github.com/shakacode/react_on_rails_rsc/pull/2490
[#2500]: https://github.com/shakacode/react_on_rails_rsc/pull/2500
```

Both RC sections remain intact with their own compare links until the stable release coalesces them. **Coalescing happens only at the stable release** — see "For Prerelease to Stable Version Release" below.

**Note**: The new version header must be inserted **at the top** (above prior version headers, and below `## [Unreleased]` if present). This ensures correct newest-first ordering of version headers, which is what `scripts/release.sh` relies on.

### For Prerelease to Stable Version Release

When releasing from prerelease to a stable version (e.g., `19.0.5-rc.1` -> `19.0.5`), this is where the accumulated prerelease sections get coalesced into one stable section. **Curate carefully** — users landing on the stable version don't care about intermediate prerelease state, and noise here makes the upgrade story harder to read.

#### Step 1: Coalesce all prerelease sections into one stable section

- Replace `## [19.0.5-rc.0]`, `## [19.0.5-rc.1]`, `## [19.0.5-beta.1]`, etc. (however many exist) with a single `## [19.0.5] - YYYY-MM-DD` section
- **Move any remaining entries from `## [Unreleased]` into the new stable section** — anything still under `[Unreleased]` at stable-release time is shipping in this stable version. Leave `## [Unreleased]` with only its header (no entries), or remove it if unused.
- Combine entries from all prerelease sections and the moved `[Unreleased]` entries, consolidating duplicate category headings (e.g., merge multiple `### Fixed` sections into one under the preferred order from "Category Organization")
- Remove the orphaned compare links at the bottom of the file for the coalesced prerelease versions
- Add the `[19.0.5]` compare link pointing from the **previous stable tag** (e.g., `19.0.4`) to `19.0.5` — **not** from the latest RC tag
- Keep the `[#NN]` PR-link definitions for every PR still referenced in the coalesced section; drop any `[#NN]` links whose entries you removed
- **Before committing**, spot-check the link updates above: orphaned RC compare links removed, the new `[19.0.5]` compare link anchored at the previous stable tag (e.g., `19.0.4...19.0.5`) — not the latest RC tag — and every remaining `([#NN])` has a matching `[#NN]:` definition.

#### Step 2: Curate the entries — REMOVE these

1. **Prerelease-only fixes** — bugs introduced during the prerelease cycle and fixed in a later RC. If the bug never shipped in a stable release, the fix is noise to stable users.
   - Investigate when a bug was introduced: `git log --oneline <last_stable>..<rc_containing_the_fix>` — search this range for the commit that introduced the bug. If the range is large and you know which files are relevant, scope it with `-- path/to/file` to cut noise. If you **find it** in this range, the bug was introduced during the RC cycle and never shipped in stable — apply the merge-or-drop rules below. If you **don't find it**, the bug predates the RC cycle and existed in `<last_stable>` — keep the fix as its own entry.
   - Check the PR description for what was broken and when
   - For RC-only regression fixes where the fix **changed user-visible behavior** of the original feature (e.g., extended an option's accepted values, adjusted a default, broadened a matcher), **merge** the fix into the original PR's entry: reference both PRs and rewrite the description so it reflects the final shipped state. Don't drop these — stable consumers see the merged behavior, not the intermediate regression.
   - **Pure-restore** fixes (the fix only restores prior behavior without changing the original entry's description) can be dropped.

2. **Refinements to prerelease-only features** — if a new feature was introduced in `rc.0` and then iterated in `rc.1`/`rc.2`, keep only the final description and drop the iteration history

3. **Internal/contributor-only tooling** — CI/build script changes, release-automation handling of prerelease version formats, local-dev tooling fixes. These don't belong in a user-facing changelog.

#### Step 3: Curate the entries — KEEP these

1. **User-facing fixes for bugs that existed in the previous stable** — if `rc.2` fixes a bug that was in `19.0.4`, that fix matters to stable users upgrading

2. **Compatibility fixes** — React/React DOM/webpack peer-dependency support, dependency relaxations, etc.

3. **All breaking changes** — public API/exports changes, removed exports, configuration changes, plugin/loader output changes. Even if a breaking change was introduced and refined across multiple prereleases, the final breaking change description belongs in stable.

4. **Performance/security improvements affecting all users**

#### Step 4: Investigation process for each entry

For each entry that doesn't obviously fall into a REMOVE or KEEP category above, ask:

- Was this bug present in the last stable release? If no, drop.
- Was this feature introduced in an earlier prerelease and then iterated/refined across later RCs? If yes, keep only the final description and drop the intermediate history.
- Does this matter to someone upgrading from the last stable to this stable? If no, drop.

#### Step 5: Final read-through

Read the resulting stable section as if you're a user upgrading from the previous stable. Every entry should be something you'd want to know about. If an entry only makes sense to someone who tracked the RC cycle, drop it.

## Examples

Run this command to see real formatting examples from the codebase:

```bash
grep -A 3 "^### " CHANGELOG.md | head -30
```

### Good Entry Example

```markdown
- Fixed the Webpack client manifest CSS collection to exclude runtime-chunk CSS, matching the existing JS-chunk filtering, so shared runtime CSS no longer leaks into every client component's Flight stylesheet hints; the server manifest still retains runtime-chunk CSS for SSR coverage. ([#52])
```

### Entry with Sub-bullets Example

```markdown
- Added `RSCRspackPlugin` and `RSCRspackLoader` exports for Rspack-native RSC client reference manifest generation. ([#52])
  - `RSCRspackPlugin`: generates the client reference manifest during Rspack builds.
  - `RSCRspackLoader`: rewrites client-component modules for the RSC graph.
```

### Breaking Change Example

```markdown
### Breaking Changes

- Removed the deprecated default export; import the named `RSCWebpackPlugin` instead. ([#52])

  **Migration Guide:**

  1. Replace `import RSCPlugin from 'react-on-rails-rsc/WebpackPlugin'` with
     `import { RSCWebpackPlugin } from 'react-on-rails-rsc/WebpackPlugin'`.
  2. Update plugin instantiation to use the named export.
```

## Additional Notes

- Keep descriptions concise but informative
- Focus on the "what" and "why", not the "how"
- Use past tense for the description
- Be consistent with existing formatting in the changelog
- Always ensure the file ends with a trailing newline
- Before a release, sanity-check the canonical GitHub Actions path with `yarn release:check` from clean synced `main`; it prints the dispatch command on success. Use `yarn release:dry-run` only for the maintainer-only local fallback path. The GitHub Actions release verifies the build with `yarn test` and `yarn build` (tsc) before publishing.
