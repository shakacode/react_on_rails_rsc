# AbanoubGhadban React Fork Patch Archive

This directory preserves the patch history from
`AbanoubGhadban/react` for issues
[#58](https://github.com/shakacode/react_on_rails_rsc/issues/58) and
[#71](https://github.com/shakacode/react_on_rails_rsc/issues/71).

These files are historical artifacts only. They are not the active
runtime-upgrade path. The current strategy is Option 5 in
[`docs/eliminate-react-fork.md`](../../../docs/eliminate-react-fork.md):
use stock `react-server-dom-webpack` from npm, with Option 4 patch files as
the fallback if a stock-runtime migration gate fails.

## Source Refs

Verified on 2026-06-13:

| Fork ref | Head SHA | Patch base | Archive directory |
| --- | --- | --- | --- |
| `rsc-patches/v19.0.1` | `bf802bd4064699910bae9cd0f618183a30caef04` | `facebook/react` tag `v19.0.1` | `rsc-patches-v19.0.1/` |
| `rsc-patches/v19.0.3` | `2c29304508de9773450421cdffa1fef6246dc4c1` | `facebook/react` tag `v19.0.3` | `rsc-patches-v19.0.3/` |
| `rsc-patches/v19.2.1` | `4a646d8b129bf9c080f6654bdfd3c40c47a6bd0b` | `facebook/react` tag `v19.2.1` | `rsc-patches-v19.2.1/` |
| `perf/rsc-revive-model-walk` | `9dc1d7e63f4a3bd6f1154f66cf108d1132e0fc8a` | common patch-stack commit `e46103dc9f4212ee664ace0c2a5fb5395adcc30c` | `topic-perf-rsc-revive-model-walk/` |
| `fix/3211-rsc-css-deferred-suspense` | `980eda22244208a90b2a21e2e10847795a85b2be` | common patch-stack commit `e46103dc9f4212ee664ace0c2a5fb5395adcc30c` | `topic-fix-3211-rsc-css-deferred-suspense/` |

The topic branches are archived relative to `e46103dc9` so their directories
contain only the topic runtime patch, not another copy of the shared plugin
patch stack.

## Generation

The archive was generated from a temporary clone:

```bash
git clone --filter=blob:none --no-checkout https://github.com/AbanoubGhadban/react.git /tmp/abanoub-react-rsc-archive
cd /tmp/abanoub-react-rsc-archive
git remote add upstream https://github.com/facebook/react.git
git fetch origin \
  refs/heads/rsc-patches/v19.0.1:refs/remotes/origin/rsc-patches/v19.0.1 \
  refs/heads/rsc-patches/v19.0.3:refs/remotes/origin/rsc-patches/v19.0.3 \
  refs/heads/rsc-patches/v19.2.1:refs/remotes/origin/rsc-patches/v19.2.1 \
  refs/heads/perf/rsc-revive-model-walk:refs/remotes/origin/perf/rsc-revive-model-walk \
  refs/heads/fix/3211-rsc-css-deferred-suspense:refs/remotes/origin/fix/3211-rsc-css-deferred-suspense
git fetch upstream \
  refs/tags/v19.0.1:refs/tags/v19.0.1 \
  refs/tags/v19.0.3:refs/tags/v19.0.3 \
  refs/tags/v19.2.1:refs/tags/v19.2.1

git format-patch v19.0.1..origin/rsc-patches/v19.0.1 -o rsc-patches-v19.0.1
git format-patch v19.0.3..origin/rsc-patches/v19.0.3 -o rsc-patches-v19.0.3
git format-patch v19.2.1..origin/rsc-patches/v19.2.1 -o rsc-patches-v19.2.1
git format-patch e46103dc9..origin/perf/rsc-revive-model-walk -o topic-perf-rsc-revive-model-walk
git format-patch e46103dc9..origin/fix/3211-rsc-css-deferred-suspense -o topic-fix-3211-rsc-css-deferred-suspense
```

## Upstream Status

- JSON-walk parsing: upstreamed in
  [facebook/react#35776](https://github.com/facebook/react/pull/35776),
  merge commit `f247ebaf44317ac6648b62f99ceaed1e4fc4dc01`.
- FOUC deferred-Suspense CSS behavior: not present in `facebook/react` main or
  tag `v19.2.7` when checked on 2026-06-13. The archived topic branch is the
  older loader-wrapper/global-manifest implementation; the current project plan
  is the wrapper-layer stock-runtime design documented in
  `docs/eliminate-react-fork.md`.
  Do not reapply the archived FOUC patch verbatim: it writes manifest state to
  `globalThis.__reactFlightClientManifest`, which is unsafe for concurrent
  renders because one request can overwrite another request's manifest. Any
  Option 4 fallback must preserve the historical intent while using
  request-scoped manifest plumbing.
- Fork archive: `AbanoubGhadban/react` was public and not archived on
  2026-06-13. The token used for this archive had pull-only permission, so
  actual repository archiving remains an owner/admin action.
