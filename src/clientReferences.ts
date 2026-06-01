/**
 * Default directories skipped by client reference discovery.
 * These are dependencies or generated asset outputs that can contain
 * framework templates and stale bundles rather than application sources.
 */
export const DEFAULT_CLIENT_REFERENCES_EXCLUDE =
  /(^|[/\\])(?:node_modules|vendor[/\\](?:bundle|cache)|public[/\\](?:assets|packs|vite|webpack|rspack|builds)|app[/\\]assets[/\\](?:builds|webpack|rspack))(?:[/\\]|$)/;

/**
 * Default source-file extensions scanned for `"use client"` directives.
 */
export const DEFAULT_CLIENT_REFERENCES_INCLUDE = /\.[cm]?[jt]sx?$/;
