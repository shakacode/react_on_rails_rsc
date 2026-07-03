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
 * The loader reads the discovered file list from module-level variables
 * set by the plugin during `beforeCompile`. The plugin and loader run
 * in the same Node process, so direct assignment works.
 */

import type { LoaderDefinition } from 'webpack';
import { getGeneratedChunkName } from './shared';

export let _discoveredClientFiles: string[] = [];
export let _chunkName = 'client[index]';
export let _generatedChunkNames: Set<string> = new Set();

const InjectionLoader: LoaderDefinition = function InjectionLoader(source) {
  // The injected import list comes from the plugin's latest FS walk, not from
  // the runtime file itself. Re-run on every watch rebuild so added/removed
  // client references refresh the runtime module instead of reusing stale
  // loader output.
  this.cacheable(false);

  if (!_discoveredClientFiles.length) return source;

  const names: string[] = [];
  const imports = _discoveredClientFiles.map((file, i) => {
    const name = getGeneratedChunkName(_chunkName, file, i);
    names.push(name);
    return `import(/* webpackChunkName: ${JSON.stringify(name)} */ ${JSON.stringify(file)});`;
  });

  _generatedChunkNames = new Set(names);
  return imports.join('\n') + '\n' + source;
};

export default InjectionLoader;
