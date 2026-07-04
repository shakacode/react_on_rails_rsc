/**
 * Injection loader — prepends dynamic import() statements to the Flight
 * client runtime module for every "use client" file discovered by the
 * plugin's FS walk.
 *
 * This replicates what the webpack RSC plugin achieves with
 * AsyncDependenciesBlock: each import() creates an async chunk group
 * attached to the runtime module. rspack does not expose a constructible
 * AsyncDependenciesBlock from JS, so dynamic imports are the only way to
 * create proper async chunks.
 *
 * The loader reads the discovered file list from state keyed by its compiler.
 * A Shakapacker RSC build can run client and server compilers in the same Node
 * process, so process-global state would make the last compiler win.
 */

import type { LoaderDefinition } from 'webpack';
import { getGeneratedChunkName } from './shared';

export let _discoveredClientFiles: string[] = [];
export let _chunkName = 'client[index]';
export let _generatedChunkNames: Set<string> = new Set();

type CompilerKey = object;

export type InjectionState = {
  discoveredClientFiles: string[];
  chunkName: string;
  generatedChunkNames: Set<string>;
};

const compilerInjectionState = new WeakMap<CompilerKey, InjectionState>();

const emptyInjectionState = (): InjectionState => ({
  discoveredClientFiles: [],
  chunkName: _chunkName,
  generatedChunkNames: new Set(),
});

const fallbackInjectionState = (): InjectionState => ({
  discoveredClientFiles: _discoveredClientFiles,
  chunkName: _chunkName,
  generatedChunkNames: _generatedChunkNames,
});

export function setInjectionStateForCompiler(
  compiler: CompilerKey,
  discoveredClientFiles: string[],
  chunkName: string,
): void {
  compilerInjectionState.set(compiler, {
    discoveredClientFiles: discoveredClientFiles.slice(),
    chunkName,
    generatedChunkNames: new Set(),
  });
}

export function getInjectionStateForCompiler(
  compiler: CompilerKey | undefined,
): InjectionState {
  if (!compiler) return fallbackInjectionState();
  return compilerInjectionState.get(compiler) ?? emptyInjectionState();
}

export function setGeneratedChunkNamesForCompiler(
  compiler: CompilerKey | undefined,
  generatedChunkNames: Iterable<string>,
): void {
  const nextGeneratedChunkNames = new Set(generatedChunkNames);
  if (!compiler) {
    _generatedChunkNames = nextGeneratedChunkNames;
    return;
  }

  const state = compilerInjectionState.get(compiler);
  if (state) {
    state.generatedChunkNames = nextGeneratedChunkNames;
    return;
  }

  compilerInjectionState.set(compiler, {
    discoveredClientFiles: [],
    chunkName: _chunkName,
    generatedChunkNames: nextGeneratedChunkNames,
  });
}

export function getGeneratedChunkNamesForCompiler(
  compiler: CompilerKey | undefined,
): Set<string> {
  return getInjectionStateForCompiler(compiler).generatedChunkNames;
}

const InjectionLoader: LoaderDefinition = function InjectionLoader(source) {
  // The injected import list comes from the plugin's latest FS walk, not from
  // the runtime file itself. Re-run on every watch rebuild so added/removed
  // client references refresh the runtime module instead of reusing stale
  // loader output.
  this.cacheable(false);

  const compiler = (this as unknown as { _compiler?: CompilerKey })._compiler;
  const { discoveredClientFiles, chunkName } = getInjectionStateForCompiler(compiler);

  if (!discoveredClientFiles.length) {
    setGeneratedChunkNamesForCompiler(compiler, []);
    return source;
  }

  const names: string[] = [];
  const imports = discoveredClientFiles.map((file, i) => {
    const name = getGeneratedChunkName(chunkName, file, i);
    names.push(name);
    return `import(/* webpackChunkName: ${JSON.stringify(name)} */ ${JSON.stringify(file)});`;
  });

  setGeneratedChunkNamesForCompiler(compiler, names);
  return imports.join('\n') + '\n' + source;
};

export default InjectionLoader;
