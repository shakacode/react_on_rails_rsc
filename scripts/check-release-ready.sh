#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ERROR_COUNT=0

# Keep npm usable in sandboxed shells where the default user cache can be
# unwritable. User-provided cache settings still win.
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${npm_config_cache:-${TMPDIR:-/tmp}/react-on-rails-rsc-npm-cache}}"

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

record_error() {
  ERROR_COUNT=$((ERROR_COUNT + 1))
  log_error "$*"
}

metadata_value() {
  node -e "const metadata = JSON.parse(process.argv[1]); process.stdout.write(String(metadata[process.argv[2]]));" "$METADATA_JSON" "$1"
}

read_release_metadata() {
  # Mirrors .github/workflows/release.yml "Read release metadata".
  METADATA_JSON=$(
    node <<'NODE'
const fs = require('node:fs');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const header = changelog.match(/^## \[([0-9][^\]]*)\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})$/m);

if (!header) {
  throw new Error('CHANGELOG.md must start its release entries with ## [X.Y.Z] - YYYY-MM-DD.');
}

const [, changelogVersion, changelogDate] = header;

if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(changelogVersion)) {
  throw new Error(`CHANGELOG.md version "${changelogVersion}" is not valid semver (expected X.Y.Z or X.Y.Z-pre.N).`);
}

if (packageJson.version !== changelogVersion) {
  throw new Error(`package.json version ${packageJson.version} does not match CHANGELOG.md ${changelogVersion}.`);
}

const releaseLines = [];
let inSection = false;
for (const line of changelog.split(/\r?\n/)) {
  if (line === header[0]) {
    inSection = true;
    continue;
  }

  if (inSection && /^## \[[0-9]/.test(line)) {
    break;
  }

  if (inSection) {
    releaseLines.push(line);
  }
}

const notes = releaseLines.join('\n').trim();
if (!notes) {
  throw new Error(`CHANGELOG.md has no release notes for ${changelogVersion}.`);
}

const isPrerelease = changelogVersion.includes('-');
console.log(JSON.stringify({
  packageName: packageJson.name,
  version: changelogVersion,
  date: changelogDate,
  npmTag: isPrerelease ? 'next' : 'latest',
  isPrerelease,
  notesLineCount: notes.split(/\r?\n/).length,
}));
NODE
  )

  PACKAGE_NAME=$(metadata_value packageName)
  RELEASE_VERSION=$(metadata_value version)
  RELEASE_DATE=$(metadata_value date)
  NPM_TAG=$(metadata_value npmTag)
  NOTES_LINE_COUNT=$(metadata_value notesLineCount)

  log_info "CHANGELOG/package metadata is ready: ${PACKAGE_NAME}@${RELEASE_VERSION} (${RELEASE_DATE})"
  echo "  - npm dist-tag on publish: ${NPM_TAG}"
  echo "  - release notes lines: ${NOTES_LINE_COUNT}"
}

check_git_tags() {
  # Mirrors release.yml tag absence, with an additional local-tag guard.
  if git show-ref --verify --quiet "refs/tags/${RELEASE_VERSION}"; then
    record_error "Release tag ${RELEASE_VERSION} already exists locally."
  else
    echo "  - Local tag ${RELEASE_VERSION} is unused"
  fi

  local output
  local status=0
  output=$(git ls-remote --exit-code --tags origin "refs/tags/${RELEASE_VERSION}" 2>&1) || status=$?
  case "$status" in
    0)
      record_error "Release tag ${RELEASE_VERSION} already exists on origin."
      printf '%s\n' "$output" >&2
      ;;
    2)
      echo "  - Origin tag ${RELEASE_VERSION} is unused"
      ;;
    *)
      record_error "Unable to verify whether origin tag ${RELEASE_VERSION} exists."
      printf '%s\n' "$output" >&2
      ;;
  esac
}

check_npm_unpublished() {
  # Mirrors release.yml "Validate release ref and publish state".
  local npm_view_output
  npm_view_output=$(mktemp)

  local attempt
  for attempt in 1 2 3 4 5; do
    local npm_exit=0
    npm --silent view "${PACKAGE_NAME}@${RELEASE_VERSION}" version --json >"$npm_view_output" 2>&1 || npm_exit=$?

    if [[ "$npm_exit" -eq 0 ]]; then
      record_error "${PACKAGE_NAME}@${RELEASE_VERSION} is already published."
      cat "$npm_view_output" >&2
      rm -f "$npm_view_output"
      return
    fi

    local error_code
    error_code=$(node - "$npm_view_output" <<'NODE'
const fs = require('node:fs');
try {
  const parsed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(parsed.error?.code || '');
} catch {
}
NODE
    )

    if [[ "$error_code" == "E404" ]]; then
      echo "  - npm version ${PACKAGE_NAME}@${RELEASE_VERSION} is unpublished"
      rm -f "$npm_view_output"
      return
    fi

    if [[ "$attempt" -lt 5 ]] && grep -Eiq 'ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network|timeout' "$npm_view_output"; then
      log_warn "npm view failed before publish; retrying in 10s (attempt ${attempt}/5):"
      cat "$npm_view_output" >&2
      sleep 10
      continue
    fi

    record_error "Unexpected npm error (code: ${error_code:-unknown}) while checking publish state."
    cat "$npm_view_output" >&2
    rm -f "$npm_view_output"
    return
  done

  rm -f "$npm_view_output"
}

show_dist_tags() {
  local dist_tags
  if dist_tags=$(npm --silent view "${PACKAGE_NAME}" dist-tags --json 2>&1); then
    echo "  - Current npm dist-tags: ${dist_tags}"
  else
    log_warn "Unable to read current npm dist-tags for ${PACKAGE_NAME}; publish-state check above is the release gate."
    printf '%s\n' "$dist_tags" >&2
  fi
}

check_release_checkout() {
  # Local-only checks that the GitHub Action enforces inside its clean checkout.
  local branch
  branch=$(git branch --show-current || true)
  if [[ "$branch" != "main" ]]; then
    record_error "Release readiness must be checked from main; current branch is ${branch:-DETACHED}."
  else
    echo "  - Current branch is main"
  fi

  if git diff --quiet && git diff --cached --quiet; then
    echo "  - Working tree is clean"
  else
    record_error "Working tree is not clean."
    git status --short >&2
  fi

  local remote_main
  local remote_status=0
  remote_main=$(git ls-remote origin refs/heads/main 2>/dev/null | awk '{print $1}') || remote_status=$?
  if [[ "$remote_status" -ne 0 || -z "$remote_main" ]]; then
    record_error "Unable to verify origin/main for sync check."
    return
  fi

  local head_sha
  head_sha=$(git rev-parse HEAD)
  if [[ "$branch" == "main" && "$head_sha" == "$remote_main" ]]; then
    echo "  - Local main matches origin/main (${remote_main})"
  elif [[ "$branch" == "main" ]]; then
    record_error "Local main (${head_sha}) does not match origin/main (${remote_main})."
  else
    log_warn "Skipped main sync pass/fail because current branch is not main; origin/main is ${remote_main}."
  fi
}

main() {
  echo ""
  echo -e "${BOLD}react-on-rails-rsc release readiness check${NC}"
  echo ""

  read_release_metadata

  echo ""
  log_info "Checking git tag state..."
  check_git_tags

  echo ""
  log_info "Checking npm publish state..."
  check_npm_unpublished
  show_dist_tags

  echo ""
  log_info "Checking release checkout state..."
  check_release_checkout

  echo ""
  if [[ "$ERROR_COUNT" -ne 0 ]]; then
    log_error "Release is not ready; ${ERROR_COUNT} check(s) failed."
    exit 1
  fi

  echo -e "${GREEN}${BOLD}Release is ready to dispatch.${NC}"
  echo ""
  echo "Run:"
  echo "  gh workflow run release.yml --ref main -f version=${RELEASE_VERSION} -f confirm_publish=publish"
  echo ""
}

main
