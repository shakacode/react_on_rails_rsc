# Claude Code Notes

`AGENTS.md` is the canonical policy for this repository. If this file conflicts
with `AGENTS.md`, follow `AGENTS.md`.

## Project Shape

`react_on_rails_rsc` is the TypeScript npm package `react-on-rails-rsc`. It is
not a Rails app or Ruby gem. Source lives in `src/`, tests live in `tests/`, and
generated build output lives in `dist/`.

`.claude/skills` is a symlink to `../.agents/skills`; add shared skills under
`.agents/skills`, not under `.claude/skills` directly. Keep
`.claude/commands/update-changelog.md` intact because it backs the
`/update-changelog` Claude Code slash command.

## Commands

See `AGENTS.md` -> **Commands** for the full command list. Use Yarn Classic;
do not use `npm` or `pnpm` for repo scripts or package management. Exception:
see `AGENTS.md` -> **Commands** for the `npm pack` carve-out used in the
verify-release flow.

For RSC test files, always set the `react-server` export condition:

```bash
NODE_CONDITIONS=react-server yarn jest tests/path/to/file.rsc.test.ts
```

`yarn build` runs `tsc` and is the typecheck. There is no separate enforced
lint, format, or type-check script. `yarn test` runs both halves of the suite:

- `yarn test:rsc`: `NODE_CONDITIONS=react-server jest tests/*.rsc.test.*`
- `yarn test:non-rsc`: `jest tests --testPathIgnorePatterns=".*\.rsc\.test\..*"`

## Release Flow

Releases are changelog-driven. Update `CHANGELOG.md`, merge that changelog PR to
`main`, then release from a clean `main` checkout.

1. Run `yarn release:dry-run` first.
2. Run `yarn verify:artifacts` to check the packed npm artifact, package
   exports, runtime peer policy, `publint`, and Are The Types Wrong.
3. Run `yarn release` only after the dry run and artifact verification succeed.

`scripts/release.sh` reads the target version from the first version header in
`CHANGELOG.md`. Do not pass a version to the release script. Tags have no `v`
prefix, for example `19.0.5-rc.7`, not `v19.0.5-rc.7`. Prereleases publish
with the npm `next` dist-tag. Current `scripts/release.sh` publishes final
non-prerelease versions with the npm `latest` dist-tag.

See `.agents/skills/update-changelog/SKILL.md` and `AGENTS.md` for release
policy. If `docs/releasing.md` exists, treat it as supplementary detail and
defer to `AGENTS.md` on conflicts. If `docs/releasing.md` is not present in your
checkout, treat its contents as `UNKNOWN`.

The runtime-line versioning policy lives in `docs/versioning.md`; use it before
choosing package versions, peer ranges, prerelease tags, or runtime-sourcing
release notes.

## React Runtime Artifacts

Never hand-edit files under `src/react-server-dom-webpack/`. Those files are
runtime artifacts produced by the React upgrade flow and replacement tooling.
Use the current `scripts/react-upgrade/upgrade.js` cherry-pick flow, and review
`docs/eliminate-react-fork.md` before changing upgrade strategy.

The current upgrade flow still depends on a local React fork path and
`[RSC-PATCH]` / `[RSC-REPLACE]` cherry-picks. Patch-file or stock-React tooling
is planned after #60/#71; do not claim it exists until those changes land.

## Validation

For docs-only or agent-doc changes, `git diff --check origin/main...HEAD` is the
minimum validation. For source, tests, package, release, or script behavior, run
the local checks from `AGENTS.md` that cover the changed surface, usually
`yarn build` and `yarn test`.
