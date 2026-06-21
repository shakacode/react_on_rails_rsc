# Consuming Unreleased Builds

Use this guide when a downstream React on Rails app needs to test a
`react-on-rails-rsc` fix before the fix is published in an official npm
release. This package is still normally consumed through `react_on_rails` and
`react_on_rails_pro`; do not import its low-level APIs directly from
application code.

Prefer a released `react-on-rails-rsc` version when possible. For temporary
testing, choose one of these workflows:

| Workflow | Use when | Tradeoff |
| --- | --- | --- |
| yalc | You are iterating locally in one downstream app. | Fastest loop, but not useful for CI or sharing. |
| Canary npm publish | Teammates or CI need the same temporary build. | Requires maintainer npm publish rights and a unique prerelease version. |
| Throwaway dist branch | A Yarn Classic app needs a Git ref and npm publishing is not appropriate. | Commits generated `dist/` output to a branch that must never be merged. |

## Why Direct Git Dependencies Break In Yarn Classic

This repository does not commit `dist/`; `.gitignore` excludes it. Published npm
tarballs include `dist/`, and this package's `prepare` and `prepack` scripts run
`yarn run build-if-needed` to create it when the package is built for publishing.

That means a plain source branch is not enough for Yarn Classic consumers. A
dependency such as this can install without the built files that this package's
exports point at:

```bash
yarn add react-on-rails-rsc@git+https://github.com/shakacode/react_on_rails_rsc.git#main
```

If `node_modules/react-on-rails-rsc/dist/client.browser.js` and the other `dist`
entry points are missing, the downstream app will fail later during bundling or
server startup. Use one of the workflows below instead of relying on Yarn
Classic to build this package from a Git dependency.

## yalc Workflow

Use yalc for a local fix/test loop when one developer controls both this checkout
and the downstream app checkout.

From this repository:

```bash
yarn
yarn build
yalc publish
```

From the downstream app:

```bash
yalc add react-on-rails-rsc
yarn install
```

After each change in this repository, rebuild and update the yalc package:

```bash
yarn build
yalc publish
```

Then refresh the app copy:

```bash
yalc update react-on-rails-rsc
yarn install
```

Do not commit yalc artifacts such as `.yalc/`, `yalc.lock`, or temporary
`package.json` dependency rewrites unless the downstream project deliberately
tracks them for its own testing workflow.

## Canary npm Publish Workflow

Use a canary publish only when a maintainer needs to share the same temporary
build with another developer or CI. This is not the official release process;
official releases still follow `docs/releasing.md` and the dist-tag policy in
`docs/versioning.md`.

Choose an unpublished prerelease version in the same package runtime line as the
branch being tested. For example, a temporary build from the `19.2.x` line might
use a version like `19.2.0-canary.20260621.<short-sha>`. Do not publish
temporary test builds to `latest`, `next`, or `rc`; `next` is reserved for the
official prerelease lane and `rc` is not an allowed npm dist-tag under this
package's release policy.

From this repository:

```bash
git switch <fix-branch>
yarn
yarn build
yarn version --new-version X.Y.Z-canary.<date>.<short-sha> --no-git-tag-version
npm publish --tag canary --access public
```

Record the exact published version. Then restore the local version edit unless
the branch is intentionally carrying that version change:

```bash
git restore package.json
```

From the downstream app, pin the exact canary version rather than the dist-tag:

```bash
yarn add react-on-rails-rsc@X.Y.Z-canary.<date>.<short-sha>
```

If `react-on-rails-rsc` is pulled in transitively through
`react-on-rails-pro`, use the downstream app's normal override mechanism. For a
Yarn Classic app, that is usually a `resolutions` entry:

```json
{
  "resolutions": {
    "react-on-rails-rsc": "X.Y.Z-canary.<date>.<short-sha>"
  }
}
```

Verify the resolved package before testing:

```bash
yarn why react-on-rails-rsc
node -p "require('react-on-rails-rsc/package.json').version"
```

## Throwaway Dist Branch Workflow

Use a throwaway dist branch when a Yarn Classic consumer must install from Git
and npm publishing is not appropriate. The branch exists only to carry generated
`dist/` files for testing.

From this repository:

```bash
git fetch origin
git switch -c throwaway/rsc-dist-<short-sha> <target-ref>
yarn
yarn build
git add -f dist
git commit -m "Build dist for <target-ref>"
git push origin HEAD
```

From the downstream app:

```bash
yarn add react-on-rails-rsc@git+https://github.com/shakacode/react_on_rails_rsc.git#throwaway/rsc-dist-<short-sha>
```

Keep this branch out of pull requests and merge queues. If the source branch
changes, rebuild `dist/` and push a new throwaway branch or commit. Delete the
branch after downstream testing no longer needs it.

## Version Pairing

`react-on-rails-rsc` is only one part of the downstream RSC stack. The package
`major.minor` tracks the React runtime line, as described in
[`versioning.md`](versioning.md). When testing an unreleased build, keep these
pieces paired from the same rollout or compatibility target:

- `react_on_rails` / `react-on-rails`
- `react_on_rails_pro` / `react-on-rails-pro`
- `react-on-rails-rsc`
- The React runtime packages expected by that RSC line, including `react`,
  `react-dom`, and the `react-server-dom-webpack` dependency resolved through
  this package

Do not move only `react-on-rails-rsc` to a different package runtime line, such
as `19.0.x` to `19.2.x`, unless the matching `react_on_rails` and
`react_on_rails_pro` branches or releases are also part of the test plan.
Version skew can show up as missing package exports, missing
`react-server-dom-webpack` subpaths, or bundler failures before the app reaches
runtime.

For a downstream Yarn Classic app, confirm the resolved package set before
calling the test successful:

```bash
yarn why react-on-rails-rsc
yarn why react-on-rails
yarn why react-on-rails-pro
```

For Ruby gems, check the app's `Gemfile.lock` or the exact Git refs in the
rollout branch. If the tested branch includes a coordinated React on Rails or
React on Rails Pro update, use that branch instead of overriding only this
package in isolation.

## Downstream Verification Checklist

Before reporting that the unreleased build works, verify the app is actually
using the intended package and that the package has built files:

```bash
node -p "require('react-on-rails-rsc/package.json').version"
test -f node_modules/react-on-rails-rsc/dist/client.browser.js
test -f node_modules/react-on-rails-rsc/dist/server.node.js
```

Then run the downstream app's normal RSC build and test path. A package install
that succeeds is not enough evidence; the RSC bundler and server-rendering paths
must also pass in the consumer app.
