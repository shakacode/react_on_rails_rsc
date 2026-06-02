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
