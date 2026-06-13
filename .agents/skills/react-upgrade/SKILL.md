---
name: react-upgrade
description: "Legacy helper for emergency maintenance of the vendored react-server-dom-webpack runtime through scripts/react-upgrade/upgrade.js and the React fork cherry-pick workflow."
argument-hint: 'See Commands section; set TARGET_VERSION and REACT_FORK_DIR, then pass needed flags.'
---

# React Upgrade

Use this skill only when a maintainer explicitly asks for emergency maintenance
of the vendored `react-server-dom-webpack` runtime artifacts in
`src/react-server-dom-webpack/`. It is not the Option 4 patch-file fallback
documented in `docs/eliminate-react-fork.md`.

## Current Rule

Never hand-edit `src/react-server-dom-webpack/`. The legacy supported flow is
the cherry-pick based script in `scripts/react-upgrade/upgrade.js`.

Read `docs/eliminate-react-fork.md` before changing the upgrade strategy. That
document records Option 5 (stock npm runtime) as the active strategy and Option
4 patch files as the fallback. This legacy script still uses a local React fork
and should not be used for new stock-runtime work.

Transition note: fork patch history is archived under
`patches/archive/abanoubghadban-react/`. Those files preserve provenance only;
they are not the active fallback patch directory.

## Prerequisites

- A local clone of the React fork that contains `rsc-patches/v<version>`
  branches and upstream `v<version>` tags.
- Dependencies installed for the upgrade helper:
  ```bash
  cd scripts/react-upgrade
  yarn install
  ```
- Dependencies installed in the React fork so it can build
  `react-server-dom-webpack`.

## Commands

From the repository root, pass the React fork as an absolute path. The current
script resolves relative `reactForkPath` values from `scripts/react-upgrade/`,
not from the caller's current directory.

> [!WARNING]
> If `.upgrade-state.json` exists in the project root, all positional arguments
> are silently ignored and saved state always wins. Run
> `cat .upgrade-state.json` from the project root first to confirm you are
> resuming the intended upgrade. To start fresh, delete the project-root
> `.upgrade-state.json` or use `--force`; if the target patch branch already
> exists in the React fork, also choose how to handle that branch. `--force`
> clears saved state but does not recreate an existing target branch. Use
> `--reset-branch` only when intentionally discarding that branch is acceptable.
>
> Before using `--continue`, verify the saved `targetVersion`, `reactForkPath`,
> `phase`, and any `conflictedCommit` match the upgrade you intend to resume. If
> any saved value is unexpected, stop and choose whether to resume, delete the
> state file, or start fresh by clearing state and intentionally handling the
> target patch branch.

```bash
TARGET_VERSION=19.1.0
REACT_FORK_DIR=/absolute/path/to/react-fork
if [ ! -d "$REACT_FORK_DIR" ]; then
  echo "Error: REACT_FORK_DIR does not exist: $REACT_FORK_DIR" >&2
  exit 1
fi
if ! git -C "$REACT_FORK_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: REACT_FORK_DIR is not a git repository: $REACT_FORK_DIR" >&2
  exit 1
fi
if ! git -C "$REACT_FORK_DIR" fetch --tags --quiet 2>/dev/null; then
  echo "Warning: could not fetch tags from React fork remote (offline or no remote)" >&2
fi
if ! git -C "$REACT_FORK_DIR" rev-parse --verify "v$TARGET_VERSION^{commit}" >/dev/null 2>&1; then
  echo "Error: React fork is missing tag v$TARGET_VERSION" >&2
  exit 1
fi
REACT_FORK="$(cd "$REACT_FORK_DIR" && pwd)"
node scripts/react-upgrade/upgrade.js "$TARGET_VERSION" "$REACT_FORK" --dry-run
```

Review the dry-run output before running the real upgrade:

```bash
node scripts/react-upgrade/upgrade.js "$TARGET_VERSION" "$REACT_FORK"
```

Useful options:

> [!WARNING]
> `--reset-branch` permanently deletes and recreates the target patch branch in
> the React fork. Use it only when intentionally discarding patch-branch work.

```bash
node scripts/react-upgrade/upgrade.js --continue # resume from .upgrade-state.json
node scripts/react-upgrade/upgrade.js "$TARGET_VERSION" "$REACT_FORK" --reset-branch # IRREVERSIBLE: deletes and recreates patch branch
node scripts/react-upgrade/upgrade.js "$TARGET_VERSION" "$REACT_FORK" --rebuild-only
node scripts/react-upgrade/upgrade.js "$TARGET_VERSION" "$REACT_FORK" --force
```

Option meanings:

- `--continue` without arguments resumes from `.upgrade-state.json`; it errors
  if no state file exists because no target version or fork path is available.
  For advanced resume edge cases, run
  `node scripts/react-upgrade/upgrade.js --help` for the current interface
  instead of relying on this skill stub.
- `--reset-branch` deletes and recreates the target patch branch in the React
  fork. This is irreversible. Use it only when intentionally discarding
  patch-branch work; commits present only on this branch, and not in any upstream
  tag or other branch, are permanently lost.

- `--rebuild-only` skips cherry-picking and rebuilds/copies artifacts from the
  current React fork checkout. Confirm the fork is already on the target patch
  branch before running it.
- `--force` skips confirmations and forces operations, including clearing
  `.upgrade-state.json` to start fresh. Use it only when intentionally
  discarding saved state; mid-conflict progress cannot be resumed from that state
  file afterward. If a cherry-pick conflict is in progress in the React fork,
  resolve it there first; `--force` does not touch the React fork's git state.

## What The Script Does

1. Creates or checks out `rsc-patches/v<targetVersion>` in the React fork from
   the upstream `v<targetVersion>` tag.
2. Finds the closest prior `rsc-patches/v...` source branch.
3. Cherry-picks `[RSC-PATCH]` commits into the React fork branch.
4. Builds `react-server-dom-webpack/` with `--releaseChannel stable` in the React fork.
5. Copies built artifacts into this repo's `src/react-server-dom-webpack/`.
6. Syncs package metadata.
7. Commits copied artifacts with
   `Update react-server-dom-webpack to React <targetVersion>`.
8. Cherry-picks the most recent consecutive `[RSC-REPLACE]` commits in this
   repo and checks for remaining standalone replacement strings.

## Conflict Handling

- React fork patch conflicts: resolve in the React fork, run
  `git cherry-pick --continue`, then resume with `node scripts/react-upgrade/upgrade.js --continue`.
- Replacement conflicts in this repo: resolve the conflicting files, stage them,
  then continue when the script prompts.
- If `.upgrade-state.json` exists, prefer `--continue` over deleting state.

## Validation

After an upgrade changes generated runtime artifacts, run the checks that cover
the changed surface:

```bash
yarn build
yarn test
# When running a targeted RSC test file directly, not through yarn test:
# NODE_CONDITIONS=react-server yarn jest tests/path/to/file.rsc.test.ts
```

If e2e scripts have landed, also run `$run-e2e` for the relevant bundler lanes
and `$downstream-e2e` when validating downstream compatibility.

For changes to the upgrade helper itself, also run:

```bash
(cd scripts/react-upgrade && node --test lib/*.test.js)
```
