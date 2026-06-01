export const DEFAULT_CLIENT_REFERENCES_EXCLUDE =
  /(^|[/\\])(?:node_modules|vendor[/\\](?:bundle|cache)|public[/\\](?:assets|packs|vite|webpack|rspack|builds)|app[/\\]assets[/\\](?:builds|webpack|rspack))(?:[/\\]|$)/;

export const DEFAULT_CLIENT_REFERENCES_INCLUDE = /\.[cm]?[jt]sx?$/;
