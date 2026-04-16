/**
 * Shared constants between loader and plugin.
 *
 * A globally-registered Symbol (via `Symbol.for`) is used instead of a
 * plain string so other plugins stashing arbitrary properties on the
 * compilation cannot collide with our channel. `Symbol.for` also round-
 * trips across module-instance boundaries — if the plugin is loaded twice
 * (e.g. once via `react-on-rails-rsc/RspackPlugin` and once via a
 * monorepo workspace alias), both copies see the same Symbol and share
 * state correctly.
 */

export const CLIENT_MODULES_KEY: symbol = Symbol.for('react-on-rails-rsc.clientModules');
