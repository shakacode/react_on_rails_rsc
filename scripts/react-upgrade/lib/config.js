// Configuration for react-upgrade scripts

export const config = {
  // Branch naming convention
  branchPrefix: 'rsc-patches/v',

  // Commit prefix regex for trusted patches
  patchPrefixRegex: /^\[RSC-PATCH/,

  // Expected scope for patch commits (for validation warnings)
  patchScope: 'packages/react-server-dom-webpack/',

  // Build command and output
  buildCommand: 'yarn build react-server-dom-webpack/ --releaseChannel stable',
  buildOutputPath: 'build/oss-stable-semver/react-server-dom-webpack',

  // Destination path (relative to react-on-rails-rsc root)
  destPath: 'src/react-server-dom-webpack',

  // Pattern to search for after copying (for interactive replacement prompts)
  searchPattern: 'react-server-dom-webpack',

  // State file name
  stateFile: '.upgrade-state.json',
};
