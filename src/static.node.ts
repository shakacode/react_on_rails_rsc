import type { Readable } from 'stream';
import { BundleManifest } from './types';
import { withStylesheetHints } from './flight-stylesheet-hints';
import {
  prerenderToNodeStream as prerenderToNodeStreamReact,
  prerender as prerenderReact,
} from 'react-server-dom-webpack/static.node';

export interface PrerenderOptions {
  environmentName?: string;
  onError?: (error: unknown) => void;
  onPostpone?: () => void;
  identifierPrefix?: string;
  signal?: AbortSignal;
}

export interface PrerenderNodeStreamResult {
  prelude: Readable;
}

export interface PrerenderResult {
  prelude: ReadableStream;
}

export const buildServerPrerenderer = (clientManifest: BundleManifest) => {
  const filePathToModuleMetadata = withStylesheetHints(clientManifest.filePathToModuleMetadata);
  return {
    prerenderToNodeStream: (
      model: unknown,
      options?: PrerenderOptions,
    ): Promise<PrerenderNodeStreamResult> =>
      prerenderToNodeStreamReact(model, filePathToModuleMetadata, options),
    prerender: (
      model: unknown,
      options?: PrerenderOptions,
    ): Promise<PrerenderResult> =>
      prerenderReact(model, filePathToModuleMetadata, options),
    reactClientManifest: filePathToModuleMetadata,
  };
};

export const prerenderToNodeStream = (
  model: unknown,
  clientManifest: BundleManifest,
  options?: PrerenderOptions,
): Promise<PrerenderNodeStreamResult> => {
  const filePathToModuleMetadata = withStylesheetHints(clientManifest.filePathToModuleMetadata);
  return prerenderToNodeStreamReact(model, filePathToModuleMetadata, options);
};

export const prerender = (
  model: unknown,
  clientManifest: BundleManifest,
  options?: PrerenderOptions,
): Promise<PrerenderResult> => {
  const filePathToModuleMetadata = withStylesheetHints(clientManifest.filePathToModuleMetadata);
  return prerenderReact(model, filePathToModuleMetadata, options);
};
