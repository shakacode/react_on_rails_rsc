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

  it('rejects a module carrying both directives', async () => {
    const source = "'use client';\n'use server';\nexport default function X() {}\n";

    await expect(collect(source)).rejects.toThrow(
      /cannot have both "use client" and "use server"/
    );
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
