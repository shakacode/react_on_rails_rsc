/**
 * Backward-compatible no-op for the historical RspackLoader export.
 *
 * RSCRspackPlugin now discovers `"use client"` files through its filesystem
 * walk and no longer injects this loader into every application module.
 */

import type { LoaderDefinition } from 'webpack';

const RSCRspackLoader: LoaderDefinition = function RSCRspackLoader(source) {
  return source;
};

export default RSCRspackLoader;
