/**
 * Default directories skipped by client reference discovery.
 * These are dependencies or generated asset outputs that can contain
 * framework templates and stale bundles rather than application sources.
 *
 * The pattern matches path segment boundaries anywhere in the relative path
 * and supports both POSIX and Windows separators.
 */
export const DEFAULT_CLIENT_REFERENCES_EXCLUDE =
  /(^|[/\\])(?:node_modules|vendor[/\\](?:bundle|cache)|public[/\\](?:assets|packs|vite|webpack|rspack|builds)|app[/\\]assets[/\\](?:builds|vite|webpack|rspack))(?:[/\\]|$)/;

/**
 * Default source-file extensions scanned for `"use client"` directives.
 * Matches JavaScript, TypeScript, JSX, TSX, and their CommonJS/ESM variants.
 */
export const DEFAULT_CLIENT_REFERENCES_INCLUDE = /\.[cm]?[jt]sx?$/;

const USE_CLIENT_REGEX = /^\s*['"]use client['"]\s*(?:;|\r?\n|$)/;
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
export function hasUseClientDirective(source: string | Buffer): boolean {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : source;
  return USE_CLIENT_REGEX.test(stripProlog(text));
}
