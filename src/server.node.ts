import { BundleManifest } from './types';
import { preinit } from 'react-dom';
import { renderToPipeableStream as renderToPipeableStreamReact } from 'react-server-dom-webpack/server.node';

export interface Options {
  environmentName?: string;
  onError?: (error: unknown) => void;
  onPostpone?: (reason: string) => void;
  identifierPrefix?: string;
}

export interface WritableStreamLike {
  write?: (...args: any[]) => unknown;
  end?: (...args: any[]) => unknown;
  on?: (event: string | symbol, listener: (...args: any[]) => unknown) => unknown;
}

export interface PipeableStream {
  abort(reason: unknown): void;
  pipe<Writable extends WritableStreamLike>(destination: Writable): Writable;
}

type ClientReferenceMetadata = BundleManifest['filePathToModuleMetadata'][string];

const RSC_CSS_PRECEDENCE = 'rsc-css';

const preinitStylesheetsForClientReference = (metadata: ClientReferenceMetadata | undefined) => {
  if (!metadata?.css) return;
  for (const href of metadata.css) {
    preinit(href, { as: 'style', precedence: RSC_CSS_PRECEDENCE });
  }
};

const withStylesheetHints = (
  filePathToModuleMetadata: BundleManifest['filePathToModuleMetadata'],
) =>
  new Proxy(filePathToModuleMetadata, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as ClientReferenceMetadata | undefined;
      preinitStylesheetsForClientReference(value);
      return value;
    },
  });

export const buildServerRenderer = (clientManifest: BundleManifest) => {
  const filePathToModuleMetadata = withStylesheetHints(clientManifest.filePathToModuleMetadata);
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
  const filePathToModuleMetadata = withStylesheetHints(clientManifest.filePathToModuleMetadata);
  return renderToPipeableStreamReact(model, filePathToModuleMetadata, options) as PipeableStream;
}
