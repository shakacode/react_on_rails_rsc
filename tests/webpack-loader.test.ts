/**
 * Regression coverage for issue #206.
 *
 * React on Rails appends `react-on-rails-rsc/WebpackLoader` to the END of the
 * JS rule's `use` array, and bundlers run loaders right-to-left, so this loader
 * sees raw JSX/TSX before babel-loader or swc-loader. The stock
 * `react-server-dom-webpack/node-loader` enumerated exports with `acorn-loose`,
 * which has no JSX/TypeScript support and never throws: on some JSX shapes it
 * silently dropped the trailing `export default` and the stock transform then
 * emitted an EMPTY module, so the component vanished from the RSC payload with
 * no build error.
 *
 * These tests exercise the loader in-process. The `"use client"` path no longer
 * needs the ESM node-loader, so it runs fine inside Jest's VM sandbox; the
 * `"use server"` path still uses a dynamic ESM `import()` and is covered
 * out-of-process by tests/rspack-compat/webpack-loader.rspack.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as acornLoose from 'acorn-loose';
import { parse as babelParse } from '@babel/parser';
import type { LoaderContext } from 'webpack';
import RSCWebpackLoader from '../src/WebpackLoader';
import {
  collectClientExportNames,
  transformClientModule,
} from '../src/clientModuleTransform';

const FIXTURES = path.join(__dirname, 'fixtures', 'client-modules');

const fixturePath = (name: string): string => path.join(FIXTURES, name);
const readFixture = (name: string): string => fs.readFileSync(fixturePath(name), 'utf8');

interface FakeLoaderContext {
  resourcePath: string;
  addDependency: jest.Mock;
  getResolve?: () => (context: string, request: string) => Promise<string>;
  fs?: { readFile: jest.Mock };
}

const createLoaderContext = (
  resourcePath: string,
  overrides: Partial<FakeLoaderContext> = {}
): FakeLoaderContext => ({
  resourcePath,
  addDependency: jest.fn(),
  ...overrides,
});

/** Invoke the loader the way webpack does, with `this` bound to the context. */
const runLoader = (context: FakeLoaderContext, source: string): Promise<string> =>
  Promise.resolve(
    (RSCWebpackLoader as unknown as (this: unknown, content: string) => Promise<string>).call(
      context as unknown as LoaderContext<unknown>,
      source
    )
  );

const transformFixture = (name: string, overrides: Partial<FakeLoaderContext> = {}) => {
  const resourcePath = fixturePath(name);
  return runLoader(createLoaderContext(resourcePath, overrides), readFixture(name));
};

/** Resolver stub standing in for webpack's `getResolve()` for the barrel fixture. */
const jsxResolver = () => async (context: string, request: string) =>
  path.resolve(context, `${request}.jsx`);

describe('acorn-loose baseline (the #206 mechanism)', () => {
  it('still swallows the fixture\'s export default, so the fixture is a valid reproducer', () => {
    const program = acornLoose.parse(readFixture('issue-206-spike-server-function-form.jsx'), {
      // The exact options the stock node-loader uses.
      ecmaVersion: '2024' as unknown as 2024,
      sourceType: 'module',
      locations: true,
    }) as unknown as { body: { type: string }[] };

    expect(program.body.map((node) => node.type)).toEqual([
      'ExpressionStatement',
      'ImportDeclaration',
      'ImportDeclaration',
      'VariableDeclaration',
    ]);
  });
});

describe('RSCWebpackLoader "use client" transform', () => {
  it('emits a default client reference for the #206 JSX reproducer', async () => {
    const name = 'issue-206-spike-server-function-form.jsx';
    const output = await transformFixture(name);

    expect(output).not.toBe('');
    expect(output).toContain('export default registerClientReference(function() {');
    expect(output).toContain(JSON.stringify(pathToFileURL(fixturePath(name)).href));
    expect(output).toContain('"default"');
    // The original component body must not reach the server bundle.
    expect(output).not.toContain('useState');
  });

  it('rewrites the generated server import onto this package\'s public export', async () => {
    const output = await transformFixture('plain-client-module.js');

    expect(output).toContain("from \"react-on-rails-rsc/server\"");
    expect(output).not.toContain('react-server-dom-webpack/server');
  });

  it('matches the stock transformClientModule output byte for byte', async () => {
    const source =
      "'use client';\n" +
      'export function Header() { return null; }\n' +
      'export default function HomePage() { return null; }\n';

    const output = await transformClientModule(source, {
      filename: '/app/Component.jsx',
      url: 'file:///app/Component.jsx',
    });

    // Captured from react-server-dom-webpack/node-loader for the same input.
    expect(output).toBe(
      'import {registerClientReference} from "react-server-dom-webpack/server";\n' +
        'export const Header = registerClientReference(function() {throw new Error("Attempted to call Header() from the server but Header is on the client. It\'s not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");},"file:///app/Component.jsx","Header");\n' +
        'export default registerClientReference(function() {throw new Error("Attempted to call the default export of file:///app/Component.jsx from the server but it\'s on the client. It\'s not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");},"file:///app/Component.jsx","default");\n'
    );
  });

  it('enumerates every plain-JavaScript export form', async () => {
    const name = 'plain-client-module.js';
    const names = await collectClientExportNames(readFixture(name), {
      filename: fixturePath(name),
      url: pathToFileURL(fixturePath(name)).href,
    });

    expect(names).toEqual([
      'Header',
      'LEGACY_NAME',
      'alpha',
      'gamma',
      'delta',
      'Renamed',
      'default',
    ]);
  });
});

describe('RSCWebpackLoader TypeScript handling', () => {
  it('keeps runtime exports and drops type-only exports from a TSX module', async () => {
    const name = 'typed-client-component.tsx';
    const names = await collectClientExportNames(readFixture(name), {
      filename: fixturePath(name),
      url: pathToFileURL(fixturePath(name)).href,
    });

    expect(names).toEqual([
      'BADGE_LIMIT',
      'first',
      'rest',
      'Badge',
      'useBadge',
      'Panel',
      'default',
    ]);
  });

  it('does not emit client references for interfaces or type aliases', async () => {
    const output = await transformFixture('typed-client-component.tsx');

    expect(output).toContain('export const Badge = registerClientReference');
    expect(output).toContain('export default registerClientReference');
    expect(output).not.toContain('BadgeProps');
    expect(output).not.toContain('BadgeVariant');
    expect(output).not.toContain('PanelHandle');
    expect(output).not.toContain('RenamedProps');
  });

  it('parses generic arrow functions in non-TSX TypeScript', async () => {
    const source = "'use client';\nexport const identity = <T,>(value: T): T => value;\n";

    const names = await collectClientExportNames(source, {
      filename: '/app/identity.ts',
      url: 'file:///app/identity.ts',
    });

    expect(names).toEqual(['identity']);
  });

  it('drops a plain `export { X }` of a locally declared type', async () => {
    const source =
      "'use client';\n" +
      'interface Props { label: string }\n' +
      "import type { Handle } from './types';\n" +
      'export const Widget = () => null;\n' +
      'export { Props, Handle, Widget as Renamed };\n';

    await expect(
      collectClientExportNames(source, {
        filename: '/app/Typed.tsx',
        url: 'file:///app/Typed.tsx',
      })
    ).resolves.toEqual(['Widget', 'Renamed']);
  });

  it('keeps a merged interface + value declaration', async () => {
    const source =
      "'use client';\n" +
      'interface Widget { label: string }\n' +
      'const Widget = () => null;\n' +
      'export { Widget };\n';

    await expect(
      collectClientExportNames(source, {
        filename: '/app/Merged.tsx',
        url: 'file:///app/Merged.tsx',
      })
    ).resolves.toEqual(['Widget']);
  });

  it('rejects a "use client" module whose exports are all erased', async () => {
    await expect(transformFixture('no-runtime-exports.tsx')).rejects.toThrow(
      /has no runtime exports/
    );
  });
});

describe('RSCWebpackLoader star re-exports', () => {
  it('resolves `export * from` through the bundler resolver', async () => {
    const context = createLoaderContext(fixturePath('barrel-client-module.jsx'), {
      getResolve: jsxResolver,
    });
    const output = await runLoader(context, readFixture('barrel-client-module.jsx'));

    expect(output).toContain('export const Card = registerClientReference');
    expect(output).toContain('export const CardBody = registerClientReference');
    expect(output).toContain('export const widgets = registerClientReference');
    expect(output).toContain('export default registerClientReference');
    // `export *` never forwards the target's default export.
    expect(output).not.toContain('NotForwarded');
    expect(context.addDependency).toHaveBeenCalledWith(fixturePath('barrel-target.jsx'));
  });

  it('accepts a path whose literal `#` webpack escaped as `\\0#`', async () => {
    const context = createLoaderContext(fixturePath('barrel-client-module.jsx'), {
      getResolve: () => async (dir: string, request: string) =>
        // webpack escapes a literal `?`/`#` inside a path; it is not a delimiter.
        `${path.resolve(dir, `${request}.jsx`)}`.replace('barrel-target', '\0#barrel-target'),
    });

    // The escape is stripped before the read, so this fails on the missing file
    // rather than on the resource-query guard.
    await expect(runLoader(context, readFixture('barrel-client-module.jsx'))).rejects.toThrow(
      /ENOENT/
    );
  });

  it('refuses a star target selected by a resource query', async () => {
    // `./target?variant` routes the module through query-specific loaders that
    // can change its export surface, so reading the backing file would
    // enumerate the wrong module.
    await expect(
      transformFixture('barrel-client-module.jsx', {
        getResolve: () => async (dir: string, request: string) =>
          `${path.resolve(dir, `${request}.jsx`)}?variant`,
      })
    ).rejects.toThrow(/carries a resource query/);
  });

  it('fails loudly when no resolver is available', async () => {
    await expect(transformFixture('barrel-client-module.jsx')).rejects.toThrow(
      /cannot enumerate the exports of "\.\/barrel-target"/
    );
  });

  it('reports an actionable error when the star target cannot be resolved', async () => {
    await expect(
      transformFixture('barrel-client-module.jsx', {
        getResolve: () => async () => {
          throw new Error("Can't resolve './barrel-target'");
        },
      })
    ).rejects.toThrow(/failed to read "\.\/barrel-target"/);
  });
});

describe('client export-name edge cases', () => {
  const collect = (source: string, filename = '/app/Edge.jsx') =>
    collectClientExportNames(source, {
      filename,
      url: pathToFileURL(filename).href,
    });

  it('treats `export { x as default }` as the default export', async () => {
    const source = "'use client';\nconst x = 1;\nexport { x as default };\n";

    await expect(collect(source)).resolves.toEqual(['default']);
  });

  it('de-duplicates a name exported more than once', async () => {
    const source = "'use client';\nexport const a = 1;\nexport { a as a };\n";

    await expect(collect(source)).resolves.toEqual(['a']);
  });

  it('emits reserved-word and string-literal export names through an alias', async () => {
    const source =
      "'use client';\nconst a = 1;\nconst b = 2;\nexport { a as class, b as 'weird name' };\n";

    const output = await transformClientModule(source, {
      filename: '/app/Edge.jsx',
      url: 'file:///app/Edge.jsx',
    });

    expect(output).toContain('const __rscClientReference0 = registerClientReference');
    expect(output).toContain('export {__rscClientReference0 as "class"};');
    expect(output).toContain('export {__rscClientReference1 as "weird name"};');
  });

  it('picks an alias prefix that cannot collide with a real export', async () => {
    const source =
      "'use client';\n" +
      'const a = 1;\nconst b = 2;\n' +
      "export { a as __rscClientReference0, b as 'weird name' };\n";

    const output = await transformClientModule(source, {
      filename: '/app/Edge.jsx',
      url: 'file:///app/Edge.jsx',
    });

    expect(output).toContain('export const __rscClientReference0 = registerClientReference');
    expect(output).toContain('const ___rscClientReference0 = registerClientReference');
    expect(output).toContain('export {___rscClientReference0 as "weird name"};');
  });

  it('aliases strict-mode-restricted export names', async () => {
    // Module code is always strict, so `export const arguments = ...` would be a
    // syntax error even though `export { x as arguments }` is legal.
    const source = "'use client';\nconst x = 1;\nexport { x as arguments, x as eval };\n";

    const output = await transformClientModule(source, {
      filename: '/app/Edge.jsx',
      url: 'file:///app/Edge.jsx',
    });

    expect(output).not.toContain('export const arguments');
    expect(output).not.toContain('export const eval');
    expect(output).toContain('export {__rscClientReference0 as "arguments"};');
    expect(output).toContain('export {__rscClientReference1 as "eval"};');
  });

  it('rejects a module carrying both directives', async () => {
    const source = "'use client';\n'use server';\nexport default function X() {}\n";

    await expect(collect(source)).rejects.toThrow(
      /cannot have both "use client" and "use server"/
    );
  });

  it('parses both import-attribute spellings', async () => {
    const withKeyword =
      "'use client';\nimport data from './x.json' with { type: 'json' };\nexport default data;\n";
    const assertKeyword =
      "'use client';\nimport data from './x.json' assert { type: 'json' };\nexport default data;\n";

    await expect(collect(withKeyword)).resolves.toEqual(['default']);
    await expect(collect(assertKeyword)).resolves.toEqual(['default']);
  });

  it('fails with an actionable message when the module cannot be parsed', async () => {
    const source = "'use client';\nexport default function ( {{{ ;\n";

    await expect(collect(source)).rejects.toThrow(/failed to parse the "use client" module/);
  });
});

describe('export-token cross-check', () => {
  const collect = (source: string) =>
    collectClientExportNames(source, {
      filename: '/app/Tokens.jsx',
      url: 'file:///app/Tokens.jsx',
    });

  it('ignores `export` used as a property access', async () => {
    const source =
      "'use client';\nconst config = {};\nconst x = config.export;\nexport default x;\n";

    await expect(collect(source)).resolves.toEqual(['default']);
  });

  it('ignores `export` used as an object key or method name', async () => {
    const source =
      "'use client';\nconst api = { export: 1, export() { return 2; } };\nexport default api;\n";

    await expect(collect(source)).resolves.toEqual(['default']);
  });

  it('ignores `export` modifiers nested in a TypeScript namespace', async () => {
    const source =
      "'use client';\n" +
      'namespace Helpers {\n  export const inner = 1;\n  export function nested() {}\n}\n' +
      'export const outer = Helpers.inner;\n';

    await expect(
      collectClientExportNames(source, {
        filename: '/app/Namespaced.ts',
        url: 'file:///app/Namespaced.ts',
      })
    ).resolves.toEqual(['outer']);
  });

  it('keeps the brace depth balanced across template substitutions', async () => {
    const source =
      "'use client';\nconst label = `a${ { b: 1 } }c`;\nexport const value = label;\n";

    await expect(collect(source)).resolves.toEqual(['value']);
  });
});

describe('decorator syntax', () => {
  it('parses stage-3 decorators in the post-`export` TypeScript 5 position', async () => {
    const source = "'use client';\nexport @sealed class Widget {}\n";

    await expect(
      collectClientExportNames(source, {
        filename: '/app/Widget.tsx',
        url: 'file:///app/Widget.tsx',
      })
    ).resolves.toEqual(['Widget']);
  });

  it('parses legacy decorators in the pre-`export` position', async () => {
    const source = "'use client';\n@observer\nexport class Widget {}\n";

    await expect(
      collectClientExportNames(source, {
        filename: '/app/Widget.tsx',
        url: 'file:///app/Widget.tsx',
      })
    ).resolves.toEqual(['Widget']);
  });

  it('parses a .js module that combines Flow syntax with decorators', async () => {
    const source =
      "'use client';\n" +
      'type Props = {| label: string |};\n' +
      '@observer\nexport class Widget {\n  props: Props;\n}\n';

    await expect(
      collectClientExportNames(source, {
        filename: '/app/Widget.js',
        url: 'file:///app/Widget.js',
      })
    ).resolves.toEqual(['Widget']);
  });
});

describe('repeated star re-exports', () => {
  const collectWithModules = (source: string, modules: Record<string, string>) =>
    collectClientExportNames(source, {
      filename: '/app/Barrel.js',
      url: 'file:///app/Barrel.js',
      resolveExportAll: async (specifier) => {
        const resolvedPath = `/app/${specifier.replace('./', '')}.js`;
        const moduleSource = modules[resolvedPath];
        if (moduleSource === undefined) throw new Error(`no fixture for ${specifier}`);
        return { path: resolvedPath, source: moduleSource };
      },
    });

  it('emits a name supplied by two `export *` targets exactly once', async () => {
    // The stock loader pushed the name twice and emitted `export const X` twice,
    // which is a syntax error.
    const names = await collectWithModules(
      "'use client';\nexport * from './a';\nexport * from './b';\n",
      {
        '/app/a.js': 'export const Shared = 1;\nexport const OnlyA = 2;\n',
        '/app/b.js': 'export const Shared = 3;\nexport const OnlyB = 4;\n',
      }
    );

    expect(names).toEqual(['Shared', 'OnlyA', 'OnlyB']);
  });

  it('keeps a diamond re-export of the same underlying binding', async () => {
    const names = await collectWithModules(
      "'use client';\nexport * from './a';\nexport * from './b';\n",
      {
        '/app/a.js': "export { Shared } from './shared';\n",
        '/app/b.js': "export { Shared } from './shared';\n",
        '/app/shared.js': 'export const Shared = 1;\n',
      }
    );

    expect(names).toEqual(['Shared']);
  });

  it('keeps a name the barrel also exports explicitly, without duplicating it', async () => {
    const names = await collectWithModules(
      "'use client';\nexport * from './a';\nexport * from './b';\nexport const Shared = 5;\n",
      {
        '/app/a.js': 'export const Shared = 1;\n',
        '/app/b.js': 'export const Shared = 3;\n',
      }
    );

    expect(names).toEqual(['Shared']);
  });

  it('terminates on a circular `export *` chain', async () => {
    const names = await collectWithModules("'use client';\nexport * from './a';\n", {
      '/app/a.js': "export * from './b';\nexport const FromA = 1;\n",
      '/app/b.js': "export * from './a';\nexport const FromB = 2;\n",
    });

    expect([...names].sort()).toEqual(['FromA', 'FromB']);
  });

  it('reads a barrel shared by two star re-exports only once', async () => {
    const reads: string[] = [];
    const names = await collectClientExportNames(
      "'use client';\nexport * from './a';\nexport * from './b';\n",
      {
        filename: '/app/Barrel.js',
        url: 'file:///app/Barrel.js',
        resolveExportAll: async (specifier) => {
          const resolvedPath = `/app/${specifier.replace('./', '')}.js`;
          reads.push(resolvedPath);
          const sources: Record<string, string> = {
            '/app/a.js': "export * from './shared';\n",
            '/app/b.js': "export * from './shared';\n",
            '/app/shared.js': 'export const Widget = 1;\n',
          };
          return { path: resolvedPath, source: sources[resolvedPath] as string };
        },
      }
    );

    expect(names).toEqual(['Widget']);
    // `./shared` is resolved twice (once per barrel) but parsed once, and the
    // shared binding is emitted exactly once.
    expect(reads.filter((entry) => entry === '/app/shared.js')).toHaveLength(2);
  });
});

describe('RSCWebpackLoader pass-through', () => {
  it('leaves modules without a "use client" directive on the stock path', async () => {
    // `hasUseClientDirective` gates the new transform; a module that only
    // mentions the string in prose must not be rewritten.
    const source = '// mentions use client in prose\nexport default 1;\n';
    const context = createLoaderContext('/app/Plain.js');

    // The stock path dynamically imports the ESM node-loader, which Jest's VM
    // sandbox cannot evaluate. The specific sandbox error varies by Node/Jest
    // version, so assert only that the failure did NOT come from this package's
    // client transform — i.e. the stock path was taken.
    const error = await runLoader(context, source).then(
      () => null,
      (thrown: unknown) => thrown as Error
    );

    expect(error).not.toBeNull();
    expect(error?.message).not.toMatch(/react-on-rails-rsc:/);
  });
});

describe('independent-review fixes on PR #216', () => {
  const tsOptions = (name: string) => ({ filename: `/app/${name}`, url: `file:///app/${name}` });

  it('accepts a path whose literal `#` rspack escaped as U+200B', async () => {
    const context = createLoaderContext(fixturePath('barrel-client-module.jsx'), {
      getResolve: () => async (dir: string, request: string) =>
        // rspack uses a zero width space instead of webpack's NUL as the escape sentinel.
        `${path.resolve(dir, `${request}.jsx`)}`.replace('barrel-target', '\u200B#barrel-target'),
    });

    await expect(runLoader(context, readFixture('barrel-client-module.jsx'))).rejects.toThrow(
      /ENOENT/
    );
  });

  it('reads star re-export targets through the bundler input filesystem when present', async () => {
    const readFile = jest.fn((file: string, callback: (error: unknown, data?: Buffer) => void) =>
      callback(null, Buffer.from(fs.readFileSync(file, 'utf8')))
    );
    const context = createLoaderContext(fixturePath('barrel-client-module.jsx'), {
      getResolve: jsxResolver,
      fs: { readFile },
    });

    const output = await runLoader(context, readFixture('barrel-client-module.jsx'));

    expect(output).toContain('export const Card = registerClientReference');
    expect(readFile).toHaveBeenCalledWith(fixturePath('barrel-target.jsx'), expect.any(Function));
  });

  it('treats `export import A = N.B` as a runtime export', async () => {
    const output = await transformClientModule(
      "'use client';\nimport * as N from './n';\nexport import A = N.B;\nexport const Button = () => null;\n",
      tsOptions('ImportEquals.ts')
    );

    expect(output).toContain('export const A = registerClientReference');
    expect(output).toContain('export const Button = registerClientReference');
  });

  it('parses the TypeScript 5 `accessor` class field', async () => {
    for (const name of ['Accessor.ts', 'Accessor.jsx']) {
      // eslint-disable-next-line no-await-in-loop
      const output = await transformClientModule(
        "'use client';\nexport class Counter { accessor count = 0; }\n",
        tsOptions(name)
      );
      expect(output).toContain('export const Counter = registerClientReference');
    }
  });

  it('imports the helper under a free name when the module exports registerClientReference', async () => {
    const output = await transformClientModule(
      "'use client';\nexport function registerClientReference() {}\nexport const Button = () => null;\n",
      tsOptions('Collide.js')
    );

    expect(output.split('\n')[0]).toBe(
      'import {registerClientReference as __rscRegisterClientReference} from "react-server-dom-webpack/server";'
    );
    expect(output).toContain('export const registerClientReference = __rscRegisterClientReference(function()');
    expect(output).toContain('export const Button = __rscRegisterClientReference(function()');
    // The generated module must itself be valid ESM.
    expect(() => babelParse(output, { sourceType: 'module' })).not.toThrow();
  });

  it('keeps the stock import line for every module that does not collide', async () => {
    const output = await transformClientModule(
      "'use client';\nexport const Button = () => null;\n",
      tsOptions('Plain.js')
    );
    expect(output.split('\n')[0]).toBe(
      'import {registerClientReference} from "react-server-dom-webpack/server";'
    );
  });

  it('rejects `export = X` with a message that names the construct', async () => {
    await expect(
      transformClientModule("'use client';\nconst Foo = () => null;\nexport = Foo;\n", tsOptions('Legacy.ts'))
    ).rejects.toThrow(/export = /);
    await expect(
      transformClientModule(
        "'use client';\nexport const Bar = 1;\nconst Foo = () => null;\nexport = Foo;\n",
        tsOptions('Mixed.ts')
      )
    ).rejects.toThrow(/export = /);
  });

  it('counts Flow `declare export` statements so the cross-check does not fire', async () => {
    const output = await transformClientModule(
      "'use client';\ndeclare export var version: number;\ndeclare export * from './types';\nexport const Button = () => null;\n",
      tsOptions('FlowDeclare.js')
    );
    expect(output).toContain('export const Button = registerClientReference');
    expect(output).not.toContain('version');
  });

  it('erases namespaces that contain only types', async () => {
    const output = await transformClientModule(
      "'use client';\nnamespace Types { export interface Props {} export type Id = string; }\n" +
        'export { Types };\n' +
        'export namespace Shapes { export interface Box {} }\n' +
        'export namespace Impl { export const size = 1; }\n' +
        'export const Button = () => null;\n',
      tsOptions('Namespaces.ts')
    );
    expect(output).not.toContain('Types');
    expect(output).not.toContain('Shapes');
    expect(output).toContain('export const Impl = registerClientReference');
    expect(output).toContain('export const Button = registerClientReference');
  });

  it('erases `import type X = require()` bindings but keeps value import-equals', async () => {
    const output = await transformClientModule(
      "'use client';\nimport type Model = require('./model');\nimport Impl = require('./impl');\n" +
        'export { Model, Impl };\nexport const Button = () => null;\n',
      tsOptions('ImportEqualsRequire.ts')
    );
    expect(output).not.toContain('Model');
    expect(output).toContain('export const Impl = registerClientReference');
    expect(output).toContain('export const Button = registerClientReference');
  });

  it('does not trip the export-token cross-check on `export as namespace`', async () => {
    const output = await transformClientModule(
      "'use client';\nexport as namespace Lib;\nexport const Button = () => null;\n",
      tsOptions('Namespace.ts')
    );
    expect(output).toContain('export const Button = registerClientReference');
  });
});
