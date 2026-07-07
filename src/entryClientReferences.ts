/**
 * Entry-scoped client-reference discovery (issue #134).
 *
 * The client-reference manifests are deliberately build-wide: both plugins
 * inject every filesystem-discovered `"use client"` file as an async chunk
 * attached to the Flight client runtime module, so any page can resolve any
 * reference at runtime. That also means chunk membership can never answer
 * "which client references does THIS entry's tree actually render?" — on
 * server builds especially, chunk merging folds every injected reference into
 * the entry chunk.
 *
 * This module answers that question from the module graph instead: a
 * depth-first walk from each entrypoint's entry modules over
 * `moduleGraph.getOutgoingConnections`, stopping at two kinds of boundary:
 *
 *  - a client-reference module (recorded, not descended into — its imports
 *    belong to the client bundle's graph, not the server tree), and
 *  - the Flight client runtime module (not descended into, because the
 *    plugin-injected references all hang off it; walking through it would
 *    mark every discovered reference reachable from every entry that imports
 *    the runtime, silently defeating the per-entry scoping).
 *
 * The traversal is shared by the webpack and rspack plugins, which pass their
 * own client-reference sets and runtime matchers. It is written against
 * structural types because the plugins run under hand-built mock compilations
 * in unit tests; when a compilation does not expose the required graph APIs,
 * `collectEntryClientReferences` returns `null` and the caller emits a
 * warning instead of a wrong (empty) artifact.
 *
 * Failure direction: the walk prefers OVER-inclusion. An extra reference in
 * an entry's list only costs preload bytes downstream; a missing reference
 * would make a filtered manifest fail a legitimate render. Concatenated
 * modules are therefore recorded through their inner modules as well, and a
 * concatenated module that swallowed the runtime is skipped rather than
 * walked (its outgoing connections would include every injected reference).
 */

import * as path from 'path';
import * as url from 'url';

export type EntryClientReferencesModule = {
  resource?: string;
  /** Inner modules of a ConcatenatedModule. */
  modules?: EntryClientReferencesModule[];
  identifier?: () => string;
};

type EntryClientReferencesConnection = {
  module?: EntryClientReferencesModule | null;
  resolvedModule?: EntryClientReferencesModule | null;
};

export type EntryClientReferencesEntrypoint = {
  getEntrypointChunk?: () => unknown;
};

export type EntryClientReferencesCompilation = {
  entrypoints?: {
    forEach(
      fn: (entrypoint: EntryClientReferencesEntrypoint, name: string) => void,
    ): void;
  };
  chunkGraph?: {
    getChunkEntryModulesIterable?(
      chunk: unknown,
    ): Iterable<EntryClientReferencesModule>;
  };
  moduleGraph?: {
    getOutgoingConnections?(
      module: EntryClientReferencesModule,
    ): Iterable<EntryClientReferencesConnection>;
  };
};

export type EntryClientReferencesPayload = {
  version: 1;
  isServer: boolean;
  compilerContext: string;
  entries: Record<
    string,
    {
      /** `file://` hrefs — the same keys the client manifests use. */
      clientReferences: string[];
      /** Compiler-context-relative paths, `/`-separated, for readability. */
      relativeClientReferences: string[];
    }
  >;
};

/**
 * Walk each entrypoint's module graph and return the client references
 * statically reachable from it, as a map of entry name to sorted absolute
 * resource paths. Returns `null` when the compilation does not expose the
 * required graph APIs (mock compilations, incompatible bundlers).
 */
export function collectEntryClientReferences(options: {
  compilation: EntryClientReferencesCompilation;
  isClientReference(resource: string): boolean;
  /** Matches the Flight client runtime module the injected references hang off. */
  isTraversalBoundary(resource: string): boolean;
}): Map<string, string[]> | null {
  const { compilation, isClientReference, isTraversalBoundary } = options;

  const entrypoints = compilation.entrypoints;
  const getChunkEntryModulesIterable =
    compilation.chunkGraph?.getChunkEntryModulesIterable?.bind(compilation.chunkGraph);
  const getOutgoingConnections =
    compilation.moduleGraph?.getOutgoingConnections?.bind(compilation.moduleGraph);
  if (
    !entrypoints ||
    typeof entrypoints.forEach !== 'function' ||
    !getChunkEntryModulesIterable ||
    !getOutgoingConnections
  ) {
    return null;
  }

  const entries = new Map<string, string[]>();
  let missingEntrypointApi = false;

  entrypoints.forEach((entrypoint, name) => {
    if (typeof entrypoint?.getEntrypointChunk !== 'function') {
      missingEntrypointApi = true;
      return;
    }

    const found = new Set<string>();
    // Keyed by identifier() or resource when available so bundlers that hand
    // out fresh wrapper objects for the same module (rspack bindings) still
    // terminate on graph cycles.
    const visited = new Set<unknown>();
    const stack: EntryClientReferencesModule[] = [
      ...getChunkEntryModulesIterable(entrypoint.getEntrypointChunk()),
    ];

    while (stack.length > 0) {
      const module = stack.pop()!;
      const visitKey =
        typeof module.identifier === 'function'
          ? module.identifier()
          : module.resource ?? module;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      // A client reference is a boundary: record it, do not walk its imports.
      if (module.resource && isClientReference(module.resource)) {
        found.add(module.resource);
        continue;
      }

      // Concatenated wrappers: record inner client references so an eagerly
      // folded-in reference is not missed (over-inclusion is the safe
      // direction), and refuse to walk a wrapper that swallowed the runtime.
      let containsBoundary = !!module.resource && isTraversalBoundary(module.resource);
      if (module.modules) {
        for (const inner of module.modules) {
          if (!inner.resource) continue;
          if (isClientReference(inner.resource)) found.add(inner.resource);
          if (isTraversalBoundary(inner.resource)) containsBoundary = true;
        }
      }
      if (containsBoundary) continue;

      for (const connection of getOutgoingConnections(module)) {
        const depModule = connection.module ?? connection.resolvedModule;
        if (depModule) stack.push(depModule);
      }
    }

    entries.set(name, [...found].sort());
  });

  return missingEntrypointApi ? null : entries;
}

/** Serialize the per-entry reference map into the emitted JSON payload. */
export function buildEntryClientReferencesPayload(options: {
  entries: Map<string, string[]>;
  compilerContext: string;
  isServer: boolean;
}): EntryClientReferencesPayload {
  const entries: EntryClientReferencesPayload['entries'] = {};
  for (const name of [...options.entries.keys()].sort()) {
    const files = options.entries.get(name)!;
    entries[name] = {
      clientReferences: files.map((file) => url.pathToFileURL(file).href),
      relativeClientReferences: files.map((file) =>
        path.relative(options.compilerContext, file).replace(/\\/g, '/'),
      ),
    };
  }
  return {
    version: 1,
    isServer: options.isServer,
    compilerContext: options.compilerContext,
    entries,
  };
}
