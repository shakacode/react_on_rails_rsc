import {
  preconnect as reactPreconnect,
  prefetchDNS as reactPrefetchDNS,
  preinit as reactPreinit,
  preload as reactPreload,
  type PreconnectOptions,
  type PreinitOptions,
  type PreloadOptions,
} from 'react-dom';
import { RSC_CSS_PRECEDENCE } from './flight-stylesheet-hints';

export type ResourceHintCrossOrigin = NonNullable<PreloadOptions['crossOrigin']>;
export type ResourceHintFetchPriority = NonNullable<PreloadOptions['fetchPriority']>;
export type ResourceHintAs = PreloadOptions['as'];
export type PreloadAssetOptions = PreloadOptions;
export type PreconnectResourceOptions = PreconnectOptions;
export type PreloadStyleOptions = Omit<PreloadOptions, 'as'>;
export type PreinitStyleOptions = Omit<PreinitOptions, 'as'>;
export type PreloadScriptOptions = Omit<PreloadOptions, 'as'>;
export type PreinitScriptOptions = Omit<PreinitOptions, 'as' | 'precedence'>;
export type PreloadFontOptions = Omit<PreloadOptions, 'as'>;
export type PreloadImageOptions = Omit<PreloadOptions, 'as'>;

export const prefetchDNS = (href: string): void => {
  reactPrefetchDNS(href);
};

export const preconnect = (href: string, options?: PreconnectResourceOptions): void => {
  reactPreconnect(href, options);
};

export const preloadAsset = (href: string, options: PreloadAssetOptions): void => {
  reactPreload(href, options);
};

export const preloadStyle = (href: string, options?: PreloadStyleOptions): void => {
  reactPreload(href, { ...options, as: 'style' });
};

export const preinitStyle = (href: string, options?: PreinitStyleOptions): void => {
  reactPreinit(href, {
    ...options,
    as: 'style',
    precedence: options?.precedence ?? RSC_CSS_PRECEDENCE,
  });
};

export const preloadScript = (href: string, options?: PreloadScriptOptions): void => {
  reactPreload(href, { ...options, as: 'script' });
};

export const preinitScript = (href: string, options?: PreinitScriptOptions): void => {
  reactPreinit(href, { ...options, as: 'script' });
};

export const preloadFont = (href: string, options?: PreloadFontOptions): void => {
  reactPreload(href, {
    ...options,
    as: 'font',
    crossOrigin: options?.crossOrigin ?? 'anonymous',
  });
};

export const preloadImage = (href: string, options?: PreloadImageOptions): void => {
  reactPreload(href, { ...options, as: 'image' });
};
