# Claude Code Notes

`AGENTS.md` is the canonical policy for this repository. If this file conflicts
with `AGENTS.md`, follow `AGENTS.md`.

## Project Shape

`react_on_rails_rsc` is the TypeScript npm package `react-on-rails-rsc`. It is
not a Rails app or Ruby gem. Source lives in `src/`, tests live in `tests/`, and
generated build output lives in `dist/`.

`.claude/skills` is a tracked symlink to `../.agents/skills`. Keep that
directory for repo-local RSC-specific skills only; shared workflow skills come
from the installed/shared `agent-workflows` pack and should not be copied here.
Keep `.claude/commands/update-changelog.md` intact because it backs the
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

Releases are changelog-driven, and the GitHub Actions `Release package`
workflow is canonical. When stamping a release, update `CHANGELOG.md` and
`package.json` to the same target version in one PR, merge that PR to `main`,
then release from a clean, synced `main` checkout.

1. Run `yarn release:check`.
2. Run the `gh workflow run release.yml --ref main ...` command printed by the
   check.
3. The Actions workflow runs `yarn build`, `yarn test`, and
   `yarn verify:artifacts` before publishing.
4. Use `yarn release:dry-run`, `yarn verify:artifacts`, and `yarn release` only
   as maintainer-only local fallback paths when GitHub Actions is blocked.

`yarn release:check` reads the target version from the first version header in
`CHANGELOG.md`, verifies `package.json` matches it, checks that the unprefixed
tag and npm version are unused, and confirms the checkout is clean synced
`main`. Tags have no `v` prefix, for example `19.0.5-rc.7`, not
`v19.0.5-rc.7`. Prereleases publish with the npm `next` dist-tag; final
non-prerelease versions publish with `latest` only after the downstream release
gate accepts the candidate.

See `AGENTS.md`, `docs/releasing.md`, and
`.agents/skills/rsc-update-changelog/SKILL.md` for release policy. If those
files conflict, `AGENTS.md` wins. If `docs/releasing.md` is not present in your
checkout, treat its contents as `UNKNOWN`.

The runtime-line versioning policy lives in `docs/versioning.md`; use it before
choosing package versions, peer ranges, prerelease tags, or runtime-sourcing
release notes.

## React Runtime Artifacts

Never hand-edit files under `src/react-server-dom-webpack/`. Those files are
runtime artifacts produced by legacy React upgrade flow and replacement
tooling. Review `docs/eliminate-react-fork.md` before changing runtime
strategy.

The stock-runtime strategy is selected, but `main` still carries the vendored
runtime and `scripts/react-upgrade/` helper. Use
`scripts/react-upgrade/upgrade.js` only for maintainer-directed emergency
maintenance of the current vendored runtime, not for the Option 4 patch-file
fallback.

Fork patch history is preserved in
`patches/archive/abanoubghadban-react/`; that archive is provenance, not an
active runtime path.

## Validation

For docs-only or agent-doc changes, `git diff --check origin/main...HEAD` is the
minimum validation. For source, tests, package, release, or script behavior, run
the local checks from `AGENTS.md` that cover the changed surface, usually
`yarn build` and `yarn test`.
