#!/usr/bin/env bash
# Downstream E2E harness: pack this package, install it into the React on Rails
# Pro dummy app, and run the maintained RSC Playwright subset.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DEFAULT_REACT_ON_RAILS_REPO="https://github.com/shakacode/react_on_rails.git"
DEFAULT_REACT_ON_RAILS_REF="main"
DEFAULT_DUMMY_BUILD_SCRIPT="build:test:rspack"
DEFAULT_RENDERER_PORT="3800"
DEFAULT_RAILS_PORT="3000"
DEFAULT_RAILS_READY_PATH="/empty"
DEFAULT_SPECS=(
  "e2e-tests/rsc_echo_props.spec.ts"
  "e2e-tests/rsc_route_ssr_false.spec.ts"
)

REACT_ON_RAILS_REPO="${RSC_DOWNSTREAM_REACT_ON_RAILS_REPO:-$DEFAULT_REACT_ON_RAILS_REPO}"
REACT_ON_RAILS_REF="${RSC_DOWNSTREAM_REACT_ON_RAILS_REF:-$DEFAULT_REACT_ON_RAILS_REF}"
REACT_ON_RAILS_REF_EXPLICIT="0"
if [[ -n "${RSC_DOWNSTREAM_REACT_ON_RAILS_REF:-}" ]]; then
  REACT_ON_RAILS_REF_EXPLICIT="1"
fi
REACT_ON_RAILS_DIR="${RSC_DOWNSTREAM_REACT_ON_RAILS_DIR:-}"
WORK_DIR="${RSC_DOWNSTREAM_WORK_DIR:-}"
AUTO_WORK_DIR="0"
KEEP_WORK_DIR="${RSC_DOWNSTREAM_KEEP:-0}"
USING_EXISTING_REACT_ON_RAILS_DIR="0"
DUMMY_BUILD_SCRIPT="${RSC_DOWNSTREAM_DUMMY_BUILD_SCRIPT:-$DEFAULT_DUMMY_BUILD_SCRIPT}"
INSTALL_PLAYWRIGHT="${RSC_DOWNSTREAM_INSTALL_PLAYWRIGHT:-1}"
INSTALL_PLAYWRIGHT_DEPS="${RSC_DOWNSTREAM_INSTALL_PLAYWRIGHT_DEPS:-0}"
REQUIRE_PRO_LICENSE="${RSC_DOWNSTREAM_REQUIRE_PRO_LICENSE:-0}"
RENDERER_PORT="${RSC_DOWNSTREAM_RENDERER_PORT:-${RENDERER_PORT:-$DEFAULT_RENDERER_PORT}}"
RAILS_PORT="${RSC_DOWNSTREAM_RAILS_PORT:-${RAILS_PORT:-$DEFAULT_RAILS_PORT}}"
RAILS_READY_PATH="${RSC_DOWNSTREAM_RAILS_READY_PATH:-$DEFAULT_RAILS_READY_PATH}"
SPEC_ARGS=()

if [[ "$RAILS_READY_PATH" != /* ]]; then
  RAILS_READY_PATH="/$RAILS_READY_PATH"
fi

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/e2e/downstream.sh [options] [-- <playwright spec>...]

Options:
  --react-on-rails-ref REF   Downstream ref to test. Default: main.
                             Existing checkouts use current HEAD unless this
                             option or RSC_DOWNSTREAM_REACT_ON_RAILS_REF is set.
  --react-on-rails-repo URL  Downstream repository URL.
  --react-on-rails-dir PATH  Use an existing downstream checkout instead of cloning.
  --work-dir PATH            Directory for the packed tarball, logs, and clone.
                             User-supplied work dirs are preserved after exit.
  --keep                     Keep the generated work directory for debugging.
  --skip-playwright-install  Skip Playwright browser installation.
  -h, --help                 Show this help.

Environment:
  RSC_DOWNSTREAM_REACT_ON_RAILS_REPO      Downstream repository URL.
  RSC_DOWNSTREAM_REACT_ON_RAILS_REF       Downstream ref to test. Default: main for clones.
  RSC_DOWNSTREAM_REACT_ON_RAILS_DIR       Existing downstream checkout path.
  RSC_DOWNSTREAM_WORK_DIR                 Directory for packed tarball, logs, and clone.
  RSC_DOWNSTREAM_KEEP                     1 = preserve generated work dir.
  RSC_DOWNSTREAM_DUMMY_BUILD_SCRIPT       Dummy build script. Default: build:test:rspack.
  RSC_DOWNSTREAM_INSTALL_PLAYWRIGHT       0 = skip Playwright browser installation.
  RSC_DOWNSTREAM_INSTALL_PLAYWRIGHT_DEPS  1 = pass --with-deps to Playwright install.
  RSC_DOWNSTREAM_REQUIRE_PRO_LICENSE      1 = fail early if REACT_ON_RAILS_PRO_LICENSE is empty.
  RSC_DOWNSTREAM_RAILS_PORT               Rails server port. Default: 3000.
  RSC_DOWNSTREAM_RAILS_READY_PATH         Rails readiness path. Default: /empty.
  RSC_DOWNSTREAM_RENDERER_PORT            Node renderer port. Default: 3800.
  RENDERER_PORT                           Node renderer port fallback when RSC_DOWNSTREAM_RENDERER_PORT is unset.
  RAILS_PORT                              Rails server port fallback when RSC_DOWNSTREAM_RAILS_PORT is unset.

Default spec subset:
  e2e-tests/rsc_echo_props.spec.ts
  e2e-tests/rsc_route_ssr_false.spec.ts
USAGE
}

while (($# > 0)); do
  case "$1" in
    --react-on-rails-ref)
      REACT_ON_RAILS_REF="${2:?--react-on-rails-ref requires a value}"
      REACT_ON_RAILS_REF_EXPLICIT="1"
      shift 2
      ;;
    --react-on-rails-repo)
      REACT_ON_RAILS_REPO="${2:?--react-on-rails-repo requires a value}"
      shift 2
      ;;
    --react-on-rails-dir)
      REACT_ON_RAILS_DIR="${2:?--react-on-rails-dir requires a value}"
      shift 2
      ;;
    --work-dir)
      WORK_DIR="${2:?--work-dir requires a value}"
      shift 2
      ;;
    --keep)
      KEEP_WORK_DIR="1"
      shift
      ;;
    --skip-playwright-install)
      INSTALL_PLAYWRIGHT="0"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      SPEC_ARGS=("$@")
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ((${#SPEC_ARGS[@]} == 0)); then
  SPEC_ARGS=("${DEFAULT_SPECS[@]}")
fi

if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ror-rsc-downstream.XXXXXX")"
  AUTO_WORK_DIR="1"
fi
mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"
PACKAGE_DIR="$WORK_DIR/package"
LOG_DIR="$WORK_DIR/logs"
NPM_CACHE_DIR="$WORK_DIR/npm-cache"
mkdir -p "$PACKAGE_DIR" "$LOG_DIR" "$NPM_CACHE_DIR"

TARBALL=""
DOWNSTREAM_SHA="UNKNOWN"
DOWNSTREAM_REF_LABEL="$REACT_ON_RAILS_REF"
NODE_RENDERER_PID=""
RAILS_PID=""
PLAYWRIGHT_CONFIG_FILE=""
LAST_STEP="initialization"
FAILED_SPECS_FILE="$WORK_DIR/failed-specs.txt"
FAILURE_SUMMARY_WRITTEN="0"
DOWNSTREAM_MUTATED_PATHS=(
  "package.json"
  "packages/react-on-rails-pro/package.json"
  "react_on_rails_pro/spec/dummy/package.json"
  "pnpm-lock.yaml"
)

cleanup() {
  local status=$?

  for pid in "$RAILS_PID" "$NODE_RENDERER_PID"; do
    kill_process_tree "$pid"
  done

  if [[ -n "$PLAYWRIGHT_CONFIG_FILE" ]]; then
    rm -f "$PLAYWRIGHT_CONFIG_FILE"
  fi

  restore_existing_checkout_manifests

  if [[ "$AUTO_WORK_DIR" != "1" ]]; then
    echo "Preserving user-supplied work dir: $WORK_DIR"
  elif [[ "$KEEP_WORK_DIR" == "1" ]]; then
    echo "RSC_DOWNSTREAM_KEEP=1 - keeping work dir: $WORK_DIR"
  else
    rm -rf "$WORK_DIR" || true
  fi

  exit "$status"
}
trap cleanup EXIT

restore_existing_checkout_manifests() {
  if [[ "$USING_EXISTING_REACT_ON_RAILS_DIR" != "1" ]] || [[ -z "$REACT_ON_RAILS_DIR" ]]; then
    return
  fi

  git -C "$REACT_ON_RAILS_DIR" checkout -- "${DOWNSTREAM_MUTATED_PATHS[@]}" 2>/dev/null || true
}

kill_process_tree() {
  local pid="$1"

  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  if command -v pgrep >/dev/null 2>&1; then
    local child_pid
    while IFS= read -r child_pid; do
      kill_process_tree "$child_pid"
    done < <(pgrep -P "$pid" 2>/dev/null || true)
  fi

  kill "$pid" 2>/dev/null || true
  local deadline=$((SECONDS + 10))
  while kill -0 "$pid" 2>/dev/null && ((SECONDS < deadline)); do
    sleep 1
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

on_error() {
  local status=$?
  echo "::error title=Downstream RSC E2E failed::Failed during: $LAST_STEP"
  if [[ "$FAILURE_SUMMARY_WRITTEN" != "1" ]]; then
    write_github_summary "failed" "$LAST_STEP"
  fi
  exit "$status"
}
trap on_error ERR

log_step() {
  LAST_STEP="$1"
  echo
  echo "==> $LAST_STEP"
}

ensure_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    return 1
  fi
}

configure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm --version
    return
  fi

  ensure_command node
  ensure_command corepack

  local package_manager
  package_manager="$(
    cd "$REACT_ON_RAILS_DIR"
    node <<'NODE'
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(process.cwd(), 'package.json');
let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to parse downstream package JSON at ${packageJsonPath}: ${message}`);
  process.exit(1);
}

const packageManager = packageJson.packageManager || '';
if (!packageManager.startsWith('pnpm@')) {
  console.error(
    `Expected downstream packageManager to start with "pnpm@" in ${packageJsonPath}; found ` +
      (packageManager || '<missing>')
  );
  process.exit(1);
}

process.stdout.write(packageManager);
NODE
  )"
  corepack enable
  corepack prepare "$package_manager" --activate
  pnpm --version
}

checkout_downstream() {
  log_step "Preparing React on Rails checkout"

  if [[ -n "$REACT_ON_RAILS_DIR" ]]; then
    USING_EXISTING_REACT_ON_RAILS_DIR="1"
    REACT_ON_RAILS_DIR="$(cd "$REACT_ON_RAILS_DIR" && pwd)"
    if [[ ! -e "$REACT_ON_RAILS_DIR/.git" ]]; then
      echo "Not a git repo or worktree: $REACT_ON_RAILS_DIR" >&2
      return 1
    fi
    echo "Using existing checkout: $REACT_ON_RAILS_DIR"
    if [[ "$REACT_ON_RAILS_REF_EXPLICIT" == "1" ]]; then
      if ! git -C "$REACT_ON_RAILS_DIR" diff-index --quiet HEAD --; then
        echo "Existing checkout has uncommitted changes; cannot check out $REACT_ON_RAILS_REF." >&2
        echo "Restore or stash the checkout, or omit --react-on-rails-ref to use the current HEAD." >&2
        return 1
      fi
      if ! git -C "$REACT_ON_RAILS_DIR" remote get-url origin >/dev/null 2>&1; then
        echo "Existing checkout has no origin remote, so $REACT_ON_RAILS_REF cannot be fetched." >&2
        return 1
      fi
      git -C "$REACT_ON_RAILS_DIR" fetch --depth 1 origin -- "$REACT_ON_RAILS_REF"
      git -C "$REACT_ON_RAILS_DIR" checkout --detach FETCH_HEAD
    else
      DOWNSTREAM_REF_LABEL="existing checkout"
      echo "No downstream ref explicitly requested; using the existing checkout HEAD."
    fi
  else
    REACT_ON_RAILS_DIR="$WORK_DIR/react_on_rails"
    # Use init+fetch so workflow_dispatch can pass branch, tag, or ref names
    # without relying on clone --branch semantics.
    git init "$REACT_ON_RAILS_DIR"
    if git -C "$REACT_ON_RAILS_DIR" remote get-url origin >/dev/null 2>&1; then
      git -C "$REACT_ON_RAILS_DIR" remote set-url origin "$REACT_ON_RAILS_REPO"
    else
      git -C "$REACT_ON_RAILS_DIR" remote add origin "$REACT_ON_RAILS_REPO"
    fi
    git -C "$REACT_ON_RAILS_DIR" fetch --depth 1 origin -- "$REACT_ON_RAILS_REF"
    git -C "$REACT_ON_RAILS_DIR" checkout --detach FETCH_HEAD
    USING_EXISTING_REACT_ON_RAILS_DIR="0"
  fi

  DOWNSTREAM_SHA="$(git -C "$REACT_ON_RAILS_DIR" rev-parse HEAD)"
  echo "React on Rails ref: $DOWNSTREAM_REF_LABEL"
  echo "React on Rails SHA: $DOWNSTREAM_SHA"
}

pack_local_package() {
  log_step "Building and packing react-on-rails-rsc"
  yarn build
  TARBALL="$PACKAGE_DIR/$(
    npm_config_cache="$NPM_CACHE_DIR" npm pack --loglevel=error --pack-destination "$PACKAGE_DIR" | tail -1
  )"
  test -f "$TARBALL"
  echo "Packed tarball: $TARBALL"
}

install_downstream_dependencies() {
  log_step "Installing downstream dependencies with packed react-on-rails-rsc"

  if [[ "$REQUIRE_PRO_LICENSE" == "1" && -z "${REACT_ON_RAILS_PRO_LICENSE:-}" ]]; then
    echo "REACT_ON_RAILS_PRO_LICENSE is required for the Pro dummy app." >&2
    return 1
  fi

  if [[ "$USING_EXISTING_REACT_ON_RAILS_DIR" == "1" ]]; then
    ensure_existing_checkout_mutation_targets_clean
    echo "Warning: mutating package manifests in existing checkout: $REACT_ON_RAILS_DIR" >&2
    echo "Restore with: git -C \"$REACT_ON_RAILS_DIR\" checkout -- ${DOWNSTREAM_MUTATED_PATHS[*]}" >&2
  fi

  node - "$REACT_ON_RAILS_DIR" "$TARBALL" <<'NODE'
const fs = require('fs');
const path = require('path');

const [root, tarball] = process.argv.slice(2);
const dependencyName = 'react-on-rails-rsc';
const tarballSpec = `file:${tarball}`;
const packageJsonPaths = [
  'package.json',
  'packages/react-on-rails-pro/package.json',
  'react_on_rails_pro/spec/dummy/package.json',
];

function readPackageJson(fullPath) {
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Expected downstream package file not found: ${fullPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse downstream package JSON at ${fullPath}: ${message}`);
  }
}

for (const relativePath of packageJsonPaths) {
  const fullPath = path.join(root, relativePath);
  const packageJson = readPackageJson(fullPath);

  for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (packageJson[sectionName]?.[dependencyName]) {
      packageJson[sectionName][dependencyName] = tarballSpec;
    }
  }

  if (relativePath === 'package.json') {
    packageJson.pnpm ||= {};
    packageJson.pnpm.overrides ||= {};
    packageJson.pnpm.overrides[dependencyName] = tarballSpec;
  }

  fs.writeFileSync(fullPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}
NODE

  configure_pnpm
  # The disposable downstream checkout has its package manifests rewritten to
  # point at the local tarball, so the lockfile must be allowed to refresh that
  # expected spec while preserving existing locked versions for unchanged deps.
  (cd "$REACT_ON_RAILS_DIR" && pnpm install --no-frozen-lockfile)

  local dummy_dir="$REACT_ON_RAILS_DIR/react_on_rails_pro/spec/dummy"
  if ! (cd "$dummy_dir" && bundle check); then
    (cd "$dummy_dir" && bundle install --jobs 4 --retry 3)
  fi
}

ensure_existing_checkout_mutation_targets_clean() {
  local dirty_paths=()
  local relative_path

  for relative_path in "${DOWNSTREAM_MUTATED_PATHS[@]}"; do
    if [[ -n "$(git -C "$REACT_ON_RAILS_DIR" status --porcelain -- "$relative_path")" ]]; then
      dirty_paths+=("$relative_path")
    fi
  done

  if ((${#dirty_paths[@]} == 0)); then
    return
  fi

  echo "Existing checkout has uncommitted edits in files this script must mutate:" >&2
  printf '  - %s\n' "${dirty_paths[@]}" >&2
  echo "Commit, stash, or restore those files before using --react-on-rails-dir." >&2
  return 1
}

build_downstream_dummy() {
  log_step "Building downstream Pro dummy app"
  local dummy_dir="$REACT_ON_RAILS_DIR/react_on_rails_pro/spec/dummy"

  (cd "$REACT_ON_RAILS_DIR" && pnpm run build) 2>&1 | tee "$LOG_DIR/pnpm-build.log"
  (cd "$dummy_dir" && bundle exec rake react_on_rails:generate_packs) 2>&1 | tee "$LOG_DIR/generate-packs.log"
  (cd "$dummy_dir" && pnpm run "$DUMMY_BUILD_SCRIPT") 2>&1 | tee "$LOG_DIR/dummy-build.log"
}

start_background_services() {
  log_step "Starting downstream Rails and node-renderer services"
  local dummy_dir="$REACT_ON_RAILS_DIR/react_on_rails_pro/spec/dummy"

  (
    cd "$dummy_dir"
    RENDERER_PORT="$RENDERER_PORT" pnpm run node-renderer
  ) >"$LOG_DIR/node-renderer.log" 2>&1 &
  NODE_RENDERER_PID="$!"

  (
    cd "$dummy_dir"
    RAILS_ENV="test" \
      REACT_RENDERER_URL="http://127.0.0.1:$RENDERER_PORT" \
      bundle exec rails server -p "$RAILS_PORT"
  ) >"$LOG_DIR/rails.log" 2>&1 &
  RAILS_PID="$!"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout_seconds="${3:-300}"
  local log_path="${4:-$LOG_DIR/rails.log}"
  local monitor_pid="${5:-}"
  local start_time="$SECONDS"

  while true; do
    if curl --fail --silent --max-time 5 "$url" >/dev/null; then
      echo "$name ready at $url after $((SECONDS - start_time))s"
      return 0
    fi

    if ! ensure_service_process_running "$name" "$monitor_pid" "$log_path"; then
      return 1
    fi

    if ((SECONDS - start_time >= timeout_seconds)); then
      echo "Timed out waiting for $name at $url" >&2
      tail -100 "$log_path" >&2 || true
      return 1
    fi
    sleep 1
  done
}

wait_for_h2c() {
  local name="$1"
  local authority="$2"
  local path="$3"
  local timeout_seconds="${4:-300}"
  local monitor_pid="${5:-}"
  local log_path="${6:-$LOG_DIR/node-renderer.log}"
  local start_time="$SECONDS"

  while true; do
    # The React on Rails Pro node renderer exposes its /info readiness endpoint
    # over h2c, so use Node's http2 client rather than curl's HTTP/1.1 probe.
    if node - "$authority" "$path" <<'NODE'
const http2 = require('node:http2');

const [authority, requestPath] = process.argv.slice(2);
const client = http2.connect(authority);
const request = client.request({ ':method': 'GET', ':path': requestPath });
let statusCode = 0;
let finished = false;

const done = (code, destroy = false) => {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (destroy) client.destroy();
  else client.close();
  process.exit(code);
};

const timer = setTimeout(() => done(1, true), 10000);
client.on('error', () => done(1, true));
request.on('error', () => done(1, true));
request.on('response', (headers) => {
  statusCode = Number(headers[':status'] || 0);
});
request.on('data', () => {});
request.on('end', () => done(statusCode >= 200 && statusCode < 300 ? 0 : 1));
request.end();
NODE
    then
      echo "$name ready at $authority$path after $((SECONDS - start_time))s"
      return 0
    fi

    if ! ensure_service_process_running "$name" "$monitor_pid" "$log_path"; then
      return 1
    fi

    if ((SECONDS - start_time >= timeout_seconds)); then
      echo "Timed out waiting for $name at $authority$path" >&2
      tail -100 "$log_path" >&2 || true
      return 1
    fi
    sleep 2
  done
}

ensure_service_process_running() {
  local name="$1"
  local pid="$2"
  local log_path="$3"

  if [[ -z "$pid" ]]; then
    echo "$name was never started (empty PID)" >&2
    return 1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  echo "$name process ($pid) exited before becoming ready" >&2
  tail -100 "$log_path" >&2 || true
  return 1
}

wait_for_services() {
  log_step "Waiting for downstream services"
  # /empty is a stable React on Rails Pro dummy route used as a cheap Rails
  # liveness probe without depending on rendered RSC content.
  wait_for_http \
    "Rails server" \
    "http://127.0.0.1:${RAILS_PORT}${RAILS_READY_PATH}" \
    300 \
    "$LOG_DIR/rails.log" \
    "$RAILS_PID"
  wait_for_h2c \
    "Node renderer" \
    "http://127.0.0.1:${RENDERER_PORT}" \
    "/info" \
    300 \
    "$NODE_RENDERER_PID"
}

install_playwright_browsers() {
  if [[ "$INSTALL_PLAYWRIGHT" != "1" ]]; then
    return
  fi

  log_step "Installing Playwright browser dependencies"
  local dummy_dir="$REACT_ON_RAILS_DIR/react_on_rails_pro/spec/dummy"

  if [[ "$INSTALL_PLAYWRIGHT_DEPS" == "1" ]]; then
    (cd "$dummy_dir" && pnpm exec playwright install --with-deps chromium)
  else
    (cd "$dummy_dir" && pnpm exec playwright install chromium)
  fi
}

collect_failed_specs() {
  local results_file="$REACT_ON_RAILS_DIR/react_on_rails_pro/spec/dummy/test-results/results.xml"
  : >"$FAILED_SPECS_FILE"

  if [[ ! -f "$results_file" ]]; then
    return
  fi

  node - "$results_file" >"$FAILED_SPECS_FILE" <<'NODE'
const fs = require('fs');

const xml = fs.readFileSync(process.argv[2], 'utf8');
const decode = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const failures = [];
const testcasePattern =
  /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
let match;

while ((match = testcasePattern.exec(xml)) !== null) {
  const attributes = match[1];
  const body = match[2] || '';
  if (!/<(?:failure|error)\b/.test(body)) continue;
  const classname = attributes.match(/\bclassname="([^"]*)"/)?.[1];
  const name = attributes.match(/\bname="([^"]*)"/)?.[1];
  failures.push([classname, name].filter(Boolean).map(decode).join(' - '));
}

if (failures.length === 0 && /<(?:failure|error)\b/.test(xml)) {
  failures.push('Playwright reported failures; see JUnit XML for details.');
}

for (const failure of failures) {
  console.log(failure);
}
NODE
}

emit_failed_spec_annotations() {
  if [[ ! -s "$FAILED_SPECS_FILE" ]]; then
    echo "::error title=Downstream RSC E2E failed::Playwright failed before writing failed spec names."
    return
  fi

  while IFS= read -r failed_spec; do
    echo "::error title=Downstream RSC spec failed::$failed_spec"
  done <"$FAILED_SPECS_FILE"
}

write_github_summary() {
  local result="$1"
  local detail="${2:-}"

  if [[ -z "${GITHUB_STEP_SUMMARY:-}" ]]; then
    return
  fi

  {
    echo "## Downstream RSC E2E"
    echo
    echo "- Result: $result"
    if [[ -n "$detail" ]]; then
      echo "- Detail: $detail"
    fi
    echo "- react-on-rails-rsc SHA: $(git rev-parse HEAD)"
    echo "- React on Rails ref: $DOWNSTREAM_REF_LABEL"
    echo "- React on Rails SHA: $DOWNSTREAM_SHA"
    if [[ -n "$TARBALL" ]]; then
      echo "- Tarball: $(basename "$TARBALL")"
    fi
    echo "- Dummy build script: $DUMMY_BUILD_SCRIPT"
    echo "- Specs:"
    for spec in "${SPEC_ARGS[@]}"; do
      echo "  - $spec"
    done

    if [[ -s "$FAILED_SPECS_FILE" ]]; then
      echo
      echo "### Failed Specs"
      while IFS= read -r failed_spec; do
        echo "- $failed_spec"
      done <"$FAILED_SPECS_FILE"
    fi
  } >>"$GITHUB_STEP_SUMMARY"
}

write_playwright_config() {
  local dummy_dir="$REACT_ON_RAILS_DIR/react_on_rails_pro/spec/dummy"
  PLAYWRIGHT_CONFIG_FILE="$dummy_dir/.react-on-rails-rsc-downstream.playwright.config.ts"

  # The Pro dummy currently uses playwright.config.ts; update this generated
  # import if the downstream app moves that base config to JavaScript.
  if [[ ! -f "$dummy_dir/playwright.config.ts" ]]; then
    echo "Expected playwright.config.ts not found in $dummy_dir; update the generated config import." >&2
    return 1
  fi

  node - "$PLAYWRIGHT_CONFIG_FILE" "$RAILS_PORT" <<'NODE'
const fs = require('fs');

const [configPath, railsPort] = process.argv.slice(2);
const baseURL = `http://127.0.0.1:${railsPort}/`;

fs.writeFileSync(
  configPath,
  `import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

const baseURL = ${JSON.stringify(baseURL)};

export default defineConfig({
  ...baseConfig,
  webServer: undefined,
  use: {
    ...baseConfig.use,
    baseURL,
  },
  projects: baseConfig.projects?.map((project) => ({
    ...project,
    use: {
      ...project.use,
      baseURL,
    },
  })),
});
`
);
NODE
}

run_playwright_subset() {
  log_step "Running downstream RSC Playwright subset"
  local dummy_dir="$REACT_ON_RAILS_DIR/react_on_rails_pro/spec/dummy"
  local test_status=0

  write_playwright_config

  set +e
  (
    cd "$dummy_dir" &&
      CI="${CI:-}" pnpm exec playwright test --config "$PLAYWRIGHT_CONFIG_FILE" "${SPEC_ARGS[@]}"
  )
  test_status=$?
  set -e

  collect_failed_specs
  if ((test_status != 0)); then
    emit_failed_spec_annotations
    write_github_summary "failed" "Playwright exited with $test_status"
    FAILURE_SUMMARY_WRITTEN="1"
    return "$test_status"
  fi

  write_github_summary "passed"
}

main() {
  ensure_command git
  ensure_command yarn
  ensure_command npm
  ensure_command node
  ensure_command bundle
  ensure_command curl

  checkout_downstream
  pack_local_package
  install_downstream_dependencies
  build_downstream_dummy
  install_playwright_browsers
  start_background_services
  wait_for_services
  run_playwright_subset
}

main "$@"
