/**
 * Test-only loader: compile a `.ts`/`.tsx` fixture to JS with the TypeScript
 * compiler's `transpileModule` (automatic JSX runtime), so fixtures can be
 * written in real JSX.
 *
 * There is no babel-loader, Babel preset, or ts-loader in this package's
 * devDependencies, but `typescript` is already there for `yarn build`, so this
 * is the smallest way to get JSX through real webpack in a test.
 *
 * Deliberately NOT applied to the RSC CSS wrapper module: the plugin requests
 * that one with a `!!` prefix, which disables every configured loader. That is
 * the whole point of the `cssWrapper` export-enumeration bug — the wrapper
 * loader always sees raw JSX/TSX.
 */

'use strict';

const ts = require('typescript');

module.exports = function tsxLoader(source) {
  const { outputText } = ts.transpileModule(source, {
    fileName: this.resourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  return outputText;
};
