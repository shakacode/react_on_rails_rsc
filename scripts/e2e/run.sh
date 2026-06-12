#!/usr/bin/env bash
# E2E pipeline harness: packed tarball -> consumer install -> webpack+rspack
# builds -> Flight render -> SSR HTML -> jsdom hydration.
#
# Callable locally (`yarn test:e2e`), from CI (.github/workflows/e2e-tests.yml),
# and from agent skills.
#
# Conventions (shared pack plumbing — keep in sync with issue #61):
#   RSC_E2E_WORK_DIR     Base working dir. Default: mktemp -d ror-rsc-e2e.XXXXXX
#   RSC_E2E_PROJECT_DIR  Consumer project dir (exported to the jest suite).
#                        Default: $RSC_E2E_WORK_DIR/project
#   RSC_E2E_BUNDLER      webpack | rspack | both. Default: both
#   RSC_E2E_KEEP         1 = keep the work dir after the run (debugging)
#   RSC_E2E_REUSE        1 = reuse an already-installed project (skips
#                        build + pack + npm install; fixture/scripts are
#                        re-copied so local edits still apply)
#   Tarball:             $RSC_E2E_WORK_DIR/react-on-rails-rsc-<version>.tgz
#                        (npm pack default naming)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

WORK_DIR="${RSC_E2E_WORK_DIR:-}"
if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ror-rsc-e2e.XXXXXX")"
fi
mkdir -p "$WORK_DIR"
PROJECT_DIR="${RSC_E2E_PROJECT_DIR:-$WORK_DIR/project}"

cleanup() {
  if [[ "${RSC_E2E_KEEP:-0}" != "1" ]]; then
    rm -rf "$WORK_DIR"
  else
    echo "RSC_E2E_KEEP=1 — keeping work dir: $WORK_DIR"
  fi
}
trap cleanup EXIT

if [[ "${RSC_E2E_REUSE:-0}" == "1" && -d "$PROJECT_DIR/node_modules/react-on-rails-rsc" ]]; then
  echo "==> Reusing installed consumer project at $PROJECT_DIR"
else
  echo "==> Building dist/"
  yarn build

  echo "==> Packing tarball into $WORK_DIR"
  # npm pack prints the tarball filename as the last stdout line.
  TARBALL="$WORK_DIR/$(npm pack --pack-destination "$WORK_DIR" | tail -1)"
  test -f "$TARBALL"
  echo "    $TARBALL"

  echo "==> Creating consumer project at $PROJECT_DIR"
  rm -rf "$PROJECT_DIR"
  mkdir -p "$PROJECT_DIR"
  # Pin the consumer's bundler/react deps to the exact versions the repo's
  # yarn.lock resolved so the CI job cannot drift when a compatible-range
  # release of webpack/rspack/react ships (the suite asserts exact chunk
  # names and current bundler behavior). jsdom is not a repo dependency and
  # is pinned explicitly.
  exact_version() { node -p "require('$1/package.json').version"; }
  cat >"$PROJECT_DIR/package.json" <<EOF
{
  "name": "ror-rsc-e2e-consumer",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "react-on-rails-rsc": "file:$TARBALL",
    "react": "$(exact_version react)",
    "react-dom": "$(exact_version react-dom)",
    "webpack": "$(exact_version webpack)",
    "@rspack/core": "$(exact_version @rspack/core)",
    "css-loader": "$(exact_version css-loader)",
    "mini-css-extract-plugin": "$(exact_version mini-css-extract-plugin)",
    "jsdom": "26.1.0"
  }
}
EOF

  echo "==> Installing consumer project (npm install of the packed tarball)"
  (cd "$PROJECT_DIR" && npm install --no-audit --no-fund --loglevel=error)
fi

echo "==> Copying fixture app + pipeline scripts"
rm -rf "$PROJECT_DIR/src" "$PROJECT_DIR/scripts" "$PROJECT_DIR/build"
cp -R "$ROOT/tests/e2e/fixture/src" "$PROJECT_DIR/src"
cp -R "$ROOT/tests/e2e/fixture/scripts" "$PROJECT_DIR/scripts"

echo "==> Running E2E suite (bundler: ${RSC_E2E_BUNDLER:-both})"
export RSC_E2E_PROJECT_DIR="$PROJECT_DIR"
export RSC_E2E_BUNDLER="${RSC_E2E_BUNDLER:-both}"
yarn jest --config tests/e2e/jest.config.js --runInBand
