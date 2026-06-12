---
name: verify-release
description: "Verify release packaging for react-on-rails-rsc with yarn verify:artifacts / scripts/verify-release.sh."
argument-hint: ''
---

# Verify Release

Use this skill before publishing or when checking that a release candidate
package contains the expected exports and runtime artifacts.

## Current Status

Issue #61 landed `scripts/verify-release.sh` and the `yarn verify:artifacts`
package script in PR #77.

Requires Node.js 20 or newer. `scripts/verify-release.sh` uses
`import.meta.resolve` for export-condition checks and exits early on older
runtimes.

From the repository root:

```bash
yarn verify:artifacts
```

The direct script entrypoint is:

```bash
bash scripts/verify-release.sh
```

The script does not take a version argument. It verifies the current checkout by
building `dist/`, packing the npm artifact, installing that packed artifact in a
temporary consumer project, checking package exports under default and
`react-server` conditions, validating the embedded React runtime peer policy,
then running `publint` and Are The Types Wrong.

## Expected Workflow

1. Read `AGENTS.md` for the current release policy.
2. Confirm the script and package script exist:
   ```bash
   test -f scripts/verify-release.sh
   node -e 'const p=require("./package.json"); if (!p.scripts?.["verify:artifacts"]) process.exit(1)'
   ```
3. Run the verifier from the repository root:
   ```bash
   yarn verify:artifacts
   ```
4. Report the exact command and result.
5. If the script is missing, report that the checkout is inconsistent with
   current `main` / #61 / PR #77 instead of substituting an ad hoc verifier.

## What It Checks

- Built `dist/` files exist for the public exports in `package.json`.
- The package exports map resolves under default and `react-server` conditions.
- The packaged React Server DOM runtime version matches package and runtime peer
  dependency policy.
- The packed npm artifact installs in a temporary consumer project.
- `publint` and Are The Types Wrong pass against the packed artifact.

Note: `npm pack` is used intentionally inside the script to match npm registry
behavior; `yarn pack` generates a different tarball and is not a substitute.

## Failure Interpretation

- Exports-map failure is likely a public `package.json` exports regression.
- Missing `dist/` file: likely a build or packaging regression; run
  `yarn build` and inspect the generated output.
- Runtime-version or peer-policy failure is likely a package/runtime metadata
  mismatch. For example, after a vendored runtime bump, root and runtime
  `peerDependencies.react` / `peerDependencies.react-dom` must match the
  embedded runtime version expected by the verifier.
- `npm pack` content failure is likely a `files` allowlist or generated artifact
  issue.
- `publint` or Are The Types Wrong failures usually indicate export-map, module
  type, or declaration-file compatibility regressions.

Do not hand-edit `src/react-server-dom-webpack/` to fix verifier failures. Use
the React upgrade flow or build/release tooling that owns the generated output.
