import { BundleManifest } from './types';
import { renderToPipeableStream as renderToPipeableStreamReact } from './react-server-dom-webpack/server.node';

export interface Options {
  environmentName?: string;
  onError?: (error: unknown) => void;
  onPostpone?: (reason: string) => void;
  identifierPrefix?: string;
}

export interface PipeableStream {
  abort(reason: unknown): void;
  pipe<Writable extends NodeJS.WritableStream>(destination: Writable): Writable;
}

export const buildServerRenderer = (clientManifest: BundleManifest) => {
  const { filePathToModuleMetadata } = clientManifest;
  return {
    renderToPipeableStream: (
      // Note: ReactClientValue is likely what React uses internally for RSC
      // We're using 'unknown' here as it's the most accurate type we can use
      // without accessing React's internal types
      model: unknown,
      options?: Options,
    ) => renderToPipeableStreamReact(model, filePathToModuleMetadata, options) as PipeableStream,
    reactClientManifest: filePathToModuleMetadata,
  };
};

export const renderToPipeableStream = (model: unknown, clientManifest: BundleManifest, options?: Options) => {
  const { filePathToModuleMetadata } = clientManifest;
  return renderToPipeableStreamReact(model, filePathToModuleMetadata, options) as PipeableStream;
}
