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

// ── directive detection (shared between loader + plugin FS walk) ──

const USE_CLIENT_REGEX = /^\s*['"]use client['"]\s*;?\s*(?:\n|$)/;
const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))+/;

function stripProlog(source: string): string {
  let s = source;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  const stripped = s.replace(LEADING_COMMENTS, '');
  if (stripped !== s) s = stripped;
  return s;
}

/** Check whether `source` starts with a `"use client"` directive. */
export function hasUseClientDirective(source: string): boolean {
  return USE_CLIENT_REGEX.test(stripProlog(source));
}
