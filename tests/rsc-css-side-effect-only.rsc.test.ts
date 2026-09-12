import * as fs from 'fs';
import * as path from 'path';
import {
  cleanupOutputDirs as cleanupWebpack,
  compile as compileWebpack,
} from './webpack-plugin/helpers/compile';
import {
  cleanupOutputDirs as cleanupRspack,
  compile as compileRspack,
} from './rspack-plugin/helpers/compile';

jest.setTimeout(180_000);

const webpackResult = compileWebpack('rsc-css-side-effect-only', {
  cssWrapper: true,
  optimizationExtra: {
    concatenateModules: true,
    minimize: true,
    sideEffects: true,
    usedExports: true,
  },
});
const rspackResult = compileRspack('rsc-css-side-effect-only', {
  cssWrapper: true,
  configExtra: {
    mode: 'production',
    optimization: {
      concatenateModules: true,
      minimize: true,
      sideEffects: true,
      usedExports: true,
    },
  },
});

const allJavaScript = (outputPath: string, assets: string[]): string =>
  assets
    .filter((asset) => asset.endsWith('.js'))
    .map((asset) => fs.readFileSync(path.join(outputPath, asset), 'utf8'))
    .join('\n');

const hasStoreReference = (manifest: {
  filePathToModuleMetadata: Record<string, unknown>;
}): boolean =>
  Object.keys(manifest.filePathToModuleMetadata).some((key) =>
    key.endsWith('/StoreRegistration.js')
  );

afterAll(() => {
  cleanupWebpack([webpackResult]);
  cleanupRspack([rspackResult]);
});

describe('side-effect-only cssWrapper modules survive production tree-shaking', () => {
  it('keeps the original side effect in the webpack client build', () => {
    expect(hasStoreReference(webpackResult.manifest)).toBe(true);
    expect(allJavaScript(webpackResult.outputPath, webpackResult.assets)).toContain(
      '__RSC_SIDE_EFFECT_ONLY__'
    );
  });

  it('keeps the original side effect in the rspack client build', () => {
    expect(hasStoreReference(rspackResult.manifest)).toBe(true);
    expect(allJavaScript(rspackResult.outputPath, rspackResult.assets)).toContain(
      '__RSC_SIDE_EFFECT_ONLY__'
    );
  });
});
