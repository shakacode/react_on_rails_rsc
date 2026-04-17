# Eliminating the React Fork Repository

**Issue:** [#31](https://github.com/shakacode/react_on_rails_rsc/issues/31)
**Status:** Plan approved, implementation pending
**Date:** 2026-04-17

## Background

Upgrading `react-server-dom-webpack` currently requires two repositories:

1. **`shakacode/react_on_rails_rsc`** (this repo) — the npm package that ships built RSC artifacts in `src/react-server-dom-webpack/`, plus native code (`WebpackPlugin`, `WebpackLoader`, `RSCRspackPlugin`, etc.)
2. **`abanoubghadban/react`** — a fork of `facebook/react` hosting `rsc-patches/v<version>` branches, each containing `[RSC-PATCH]` commits on top of upstream React version tags.

The fork exists solely to park a small set of source-level patches against React's `packages/react-server-dom-webpack/`, build the patched package, and copy the output into this repo. It has no independent consumers.

### Current upgrade flow (via `scripts/react-upgrade/`)

```
abanoubghadban/react                           shakacode/react_on_rails_rsc
┌──────────────────────────────┐               ┌──────────────────────────────┐
│ v19.0.0 (upstream tag)       │               │                              │
│ rsc-patches/v19.0.0          │  upgrade.js   │ src/react-server-dom-webpack/ │
│   ├─ [RSC-PATCH] commit A    │──────────────>│   (built output copied here) │
│   ├─ [RSC-PATCH] commit B    │  build+copy   │                              │
│   └─ [RSC-PATCH] commit C    │               │ [RSC-REPLACE] commits        │
└──────────────────────────────┘               └──────────────────────────────┘
```

### Pain points

- Two repos to maintain with disconnected histories
- Cross-repo changes require two commits and two push cycles
- Patches are invisible from this repo's PR/review flow
- CI/automation needs credentials and clone access to the fork
- The fork accumulates upstream drift and must be periodically rebased

## Options Investigated

### Option 1: Git Submodule

Embed `abanoubghadban/react` as a submodule at `vendor/react/`.

```
react-on-rails-rsc/
├── .gitmodules                     ← "vendor/react → abanoubghadban/react"
├── vendor/react/                   ← submodule (gitlinked to a specific commit)
├── src/react-server-dom-webpack/   ← built artifacts (unchanged)
└── scripts/react-upgrade/
```

**How it works:** The parent repo stores a pointer (commit SHA) to a specific commit in the submodule. Files inside the submodule are read-write. Commits made inside the submodule belong to the submodule's own git history and are pushed to the submodule's remote (`abanoubghadban/react`), not the parent's remote.

**Pros:**
- One `git clone --recurse-submodules` gets both repos
- Upgrade script works unchanged (point `--reactForkPath` to `vendor/react`)

**Cons:**
- Still two GitHub repos; commits inside the submodule push to `abanoubghadban/react`
- React's `.git` history is ~500 MB+ — every contributor pays this on `submodule update --init`
- Submodules require explicit init (`git submodule update --init`); forgotten init = empty directory
- Cross-repo changes still require two commits (one in submodule, one pointer bump in parent)
- Push ordering matters: child must be pushed before parent, or other clones break
- Submodule checkout lands in detached HEAD by default; commits without a branch can be lost

**Verdict:** Does not actually eliminate the fork repo. Marginal ergonomic improvement at the cost of significant submodule complexity.

### Option 2: Git Subtree

Import the React fork into `vendor/react/` using `git subtree add`.

```bash
git subtree add --prefix=vendor/react \
    git@github.com:abanoubghadban/react.git rsc-patches/v19.0.0 --squash
```

**How it works:** Copies the full tree of the specified branch/commit into the repo as regular files. With `--squash`, history is condensed into a single merge commit. Can push changes back upstream with `git subtree push`.

**Pros:**
- Single repo, single remote, no submodule ceremony
- Can still `subtree push` to preserve the fork if needed

**Cons:**
- Even with `--squash`, the repo balloons significantly (React's source tree is large)
- Without `--squash`: GB-scale history merged into this repo
- Every contributor clone pays the size cost permanently
- Subtree merges during upgrades are more complex than the current cherry-pick flow
- React source has no reason to live permanently in the distribution repo

**Verdict:** Too expensive in repo size. The React source tree is large and has no value to npm consumers or regular contributors.

### Option 3: On-Demand Clone (Script-Managed)

Keep the fork repo, but have `upgrade.js` automatically clone it on demand into a gitignored directory.

```
react-on-rails-rsc/
├── vendor/react/      ← .gitignored; cloned by upgrade.js on first run
└── scripts/react-upgrade/
    └── upgrade.js     ← auto-clones abanoubghadban/react if not present
```

**How it works:** The upgrade script checks if `vendor/react` exists. If not, it clones the fork. All interaction with the fork is automated and local.

**Pros:**
- Zero impact on normal contributors and CI
- Upgrade becomes a single command
- Minimal changes to existing code

**Cons:**
- Still two GitHub repos to maintain
- Patches still live in the fork, invisible from this repo

**Verdict:** A cheap ergonomic improvement worth doing regardless. Does not eliminate the fork though — just hides it better.

### Option 4: Patch Files (Selected)

Store `[RSC-PATCH]` commits as `.patch` files in this repo. Build from vanilla `facebook/react` (no fork needed).

```
react-on-rails-rsc/
├── patches/react-server-dom-webpack/
│   ├── v19.0.0/
│   │   ├── 0001-rsc-patch-add-ror-support.patch
│   │   ├── 0002-rsc-patch-fix-streaming.patch
│   │   └── 0003-rsc-patch-custom-manifest.patch
│   └── v19.1.0/
│       └── ...
├── src/react-server-dom-webpack/   ← built output (unchanged)
└── scripts/react-upgrade/
    └── upgrade.js                  ← rewritten to use git am instead of cherry-pick
```

**How it works:** The upgrade script shallow-clones vanilla `facebook/react` at the target version tag into a temporary directory, applies the `.patch` files with `git am`, builds, copies output, and discards the clone.

**Upgrade flow:**
```
facebook/react (upstream, not forked)         shakacode/react_on_rails_rsc
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ v19.2.0 tag (shallow clone)  │              │ patches/v19.2.0/             │
│   + git am 0001-*.patch      │  build+copy  │   ├─ 0001-*.patch            │
│   + git am 0002-*.patch      │─────────────>│   └─ 0002-*.patch            │
│   + git am 0003-*.patch      │              │ src/react-server-dom-webpack/ │
│   (temporary, discarded)     │              │   (built output)             │
└──────────────────────────────┘              └──────────────────────────────┘
```

**Pros:**
- One repo, one remote. `abanoubghadban/react` can be archived/deleted
- Patches are reviewable text files in normal PRs
- No submodule/subtree complexity or repo size bloat
- Builds from vanilla `facebook/react` — no fork trust chain
- CI needs no auth to a second repo
- Follows established patterns (Debian, Nixpkgs, Arch AUR all use this for patching upstream)

**Cons:**
- One-time migration cost: export existing `[RSC-PATCH]` branches to `.patch` files (trivially scriptable with `git format-patch`)
- Rebase-on-conflict UX differs slightly from cherry-pick (`git am --continue` instead of `git cherry-pick --continue`)
- Major upstream React refactors may require manual patch rebasing — but this is the same pain as today with cherry-pick conflicts

**Verdict:** Best option. Fully eliminates the fork. Patches become first-class, reviewable artifacts in this repo.

## Decision

**We are going with Option 4 (patch files).**

## Implementation Plan

Implementation will begin in a follow-up issue after the currently open PRs are merged (#29, #21, #20, #11).

High-level steps:

1. **Export existing patches** — Run `git format-patch` on each `rsc-patches/v<version>` branch in `abanoubghadban/react` to produce `.patch` files. Commit them to `patches/react-server-dom-webpack/v<version>/`.

2. **Rewrite `scripts/react-upgrade/upgrade.js`** — Replace the cherry-pick workflow with:
   - Shallow-clone `facebook/react` at the target tag into a temp directory
   - `git am` the patch files from `patches/react-server-dom-webpack/v<version>/`
   - Build and copy (existing `buildAndCopy` logic, unchanged)
   - Clean up temp clone

3. **Update patch management tooling** — Add helper scripts for:
   - Creating a new patch version directory from an existing one
   - Rebasing patches against a new upstream tag
   - Validating that patches apply cleanly (CI check)

4. **Update CI** — Remove any references to `abanoubghadban/react`. Add a CI job to validate patches apply cleanly against their target React version.

5. **Archive `abanoubghadban/react`** — Once everything is verified, archive or delete the fork.
