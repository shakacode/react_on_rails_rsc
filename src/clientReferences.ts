import * as acorn from 'acorn-loose';

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

type DirectiveStatement = {
  directive?: string;
  end: number;
  expression?: {
    type?: string;
    value?: unknown;
  };
  type?: string;
};

type ParsedProgram = {
  body?: DirectiveStatement[];
};

function hasDirectiveTerminator(source: string, end: number): boolean {
  if (source[end - 1] === ';') return true;

  let i = end;
  while (i < source.length) {
    const charCode = source.charCodeAt(i);
    if (charCode === 9 || charCode === 11 || charCode === 12 || charCode === 32) {
      i += 1;
      continue;
    }
    if (charCode === 10 || charCode === 13) return true;
    if (source.startsWith('//', i)) return true;
    if (source.startsWith('/*', i)) {
      const commentEnd = source.indexOf('*/', i + 2);
      if (commentEnd === -1) return false;
      if (/[\r\n]/.test(source.slice(i + 2, commentEnd))) return true;
      i = commentEnd + 2;
      continue;
    }
    return false;
  }

  return true;
}

/** Check whether `source` starts with a `"use client"` directive. */
export function hasUseClientDirective(source: string | Buffer): boolean {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : source;
  if (!text.includes('use client')) return false;

  let program: ParsedProgram;
  try {
    program = acorn.parse(text, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as ParsedProgram;
  } catch {
    return false;
  }

  for (const statement of program.body || []) {
    if (
      statement.type !== 'ExpressionStatement' ||
      statement.expression?.type !== 'Literal' ||
      typeof statement.expression.value !== 'string'
    ) {
      return false;
    }

    if (!statement.directive) return false;
    if (!hasDirectiveTerminator(text, statement.end)) return false;
    if (statement.directive === 'use client') return true;
  }

  return false;
}
