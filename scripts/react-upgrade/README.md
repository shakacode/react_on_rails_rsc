# React Upgrade Scripts

Automation scripts to upgrade `react-server-dom-webpack` from the React fork to `react-on-rails-rsc`.

## Prerequisites

- Node.js 18+
- A local clone of the React fork with RSC patches
- Yarn installed in the React fork

## Installation

```bash
cd scripts/react-upgrade
yarn install
```

## Usage

### Basic Upgrade

```bash
node upgrade.js <targetVersion> <reactForkPath>

# Example
node upgrade.js 19.1.0 ../react
```

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be done without making changes |
| `--force` | Skip confirmations and force operations |
| `--continue` | Resume from state file, or from target branch if version/path provided |
| `--reset-branch` | Delete existing target branch and recreate from tag |
| `--rebuild-only` | Skip cherry-picking, only rebuild and copy |
| `--verbose, -v` | Enable verbose output |
| `--help, -h` | Show help message |

### Examples

```bash
# Dry run to see what would happen
node upgrade.js 19.1.0 ../react --dry-run

# Resume from state file
node upgrade.js --continue

# Resume from target branch (when state file doesn't exist)
node upgrade.js 19.1.0 ../react --continue

# Force start fresh (ignore existing state)
node upgrade.js 19.1.0 ../react --force

# Delete existing target branch and start over
node upgrade.js 19.1.0 ../react --reset-branch

# Only rebuild without cherry-picking patches
node upgrade.js 19.1.0 ../react --rebuild-only
```

## Workflow

The upgrade process follows these steps:

1. **Setup Target Branch**: Create `rsc-patches/v<version>` branch from the `v<version>` tag in the React fork
   - If branch exists and differs from tag, requires `--continue` or `--reset-branch`
2. **Find Source Branch**: Locate the closest previous patch branch (e.g., `rsc-patches/v19.0.0`)
3. **Cherry-pick Patches**: Apply commits from the source branch to the new target branch
   - Auto-apply commits with `[RSC-PATCH]` prefix
   - Prompt for other commits (use `--force` to auto-apply all)
   - Saves conflicted commit hash to resume correctly with `--continue`
4. **Build React**: Run `yarn build react-server-dom-webpack/ --releaseChannel stable`
5. **Copy Artifacts**: Copy build output to `src/react-server-dom-webpack/`
6. **Sync package.json**: Update dependencies, peerDependencies, and peerDependenciesMeta
7. **Commit Build Artifacts**: Commit the copied files with message `Update react-server-dom-webpack to React <version>`
8. **Cherry-pick Replacements**: Apply the most recent consecutive `[RSC-REPLACE]` commits
9. **Check Replacements**: Prompt to replace remaining standalone `react-server-dom-webpack` mentions
   - Only searches in `src/react-server-dom-webpack/`
   - Excludes `package.json` and `README.md` files
   - Matches standalone word only (not filenames like `react-server-dom-webpack-client.js`)
10. **Commit Replacements**: Commit replacement changes with `[RSC-REPLACE]` prefix

## Commit Prefixes

The scripts use special commit prefixes to identify commits:

| Prefix | Description | Location |
|--------|-------------|----------|
| `[RSC-PATCH]` | Patches to React source code | React fork |
| `[RSC-REPLACE]` | String replacements in built files | react-on-rails-rsc |

## State Management

The script saves progress to `.upgrade-state.json` in the project root. This allows resuming interrupted upgrades with `--continue`.

The state file tracks:
- Target version and React fork path
- Current phase (cherry-pick, build, sync, replacements, check)
- Conflicted commit hash (if cherry-pick was interrupted by a conflict)

You can also resume without a state file by providing version and path: `node upgrade.js 19.1.0 ../react --continue` - this will resume if the target branch exists.

## Module Structure

```
scripts/react-upgrade/
├── upgrade.js              # Main orchestrator
├── package.json            # Dependencies
├── README.md               # This file
└── lib/
    ├── config.js           # Configuration constants
    ├── logger.js           # Colored logging utilities
    ├── version-utils.js    # Semver parsing and comparison
    ├── git-utils.js        # Git command helpers
    ├── find-source-branch.js    # Find closest patch branch
    ├── cherry-pick-patches.js   # Cherry-pick from React fork
    ├── cherry-pick-replacements.js  # Cherry-pick replacement commits
    ├── build-and-copy.js   # Build React and copy files
    ├── sync-package-json.js    # Sync package.json fields
    ├── check-replacements.js   # Search and prompt for replacements
    ├── state-manager.js    # State file management
    └── *.test.js           # Unit tests
```

## Running Tests

```bash
cd scripts/react-upgrade

# Run all tests
node --test lib/*.test.js

# Run specific test file
node --test lib/version-utils.test.js
```

## Troubleshooting

### Build fails

If the React build fails:
1. Check the React fork is on the correct tag/branch
2. Ensure `yarn install` was run in the React fork
3. Check for any uncommitted changes that might cause conflicts

Use `--continue` to retry after fixing issues.

### Cherry-pick conflicts

When conflicts occur during cherry-picking patches (in React fork):
1. The script will save the conflicted commit hash and exit
2. Resolve conflicts manually in the React fork
3. Complete the cherry-pick with `git cherry-pick --continue`
4. Run `node upgrade.js --continue` to resume

When conflicts occur during cherry-picking replacements (in react-on-rails-rsc):
1. The script will pause and show the conflicting commit
2. Resolve conflicts manually in another terminal
3. Stage resolved files with `git add`
4. Press Enter to continue, or type "skip" to skip the commit

### Branch already exists

If the target branch `rsc-patches/v<version>` already exists:
- Use `--continue` to resume on the existing branch
- Use `--reset-branch` to delete it and start fresh from the tag

### State file issues

If you get state-related errors:
- Use `--force` to start fresh
- Or manually delete `.upgrade-state.json`
