/**
 * Issue #217 / #4598 — the `cssWrapper` loader's export enumeration.
 *
 * The generated wrapper REPLACES the client module's export surface (the client
 * manifest points at the wrapper, not the original file), and the loader is
 * applied with a `!!` prefix so it always sees RAW source. It therefore has to
 * enumerate exactly the names `src/WebpackLoader.ts` puts in the server-side
 * client-reference stub, or a name the server advertises has no implementation
 * on the client and rendering it blows up with an invalid element type.
 *
 * Before the fix this loader used `es-module-lexer` on raw source, which cannot
 * parse JSX: `export const Card = ({t}) => <section className="card">{t}</section>`
 * threw, the loader silently fell back to `['default']`, and every named export
 * disappeared from the wrapper.
 */
import { parse as babelParse } from '@babel/parser';
import type { LoaderContext } from 'webpack';
import rscCssWrapperLoader from '../src/webpack/rscCssWrapperLoader';
import { collectClientExportNames } from '../src/clientModuleTransform';

interface RunOptions {
  /** Virtual files reachable from `export * from '...'`, keyed by absolute path. */
  files?: Record<string, string>;
  /** Omit to run without a bundler resolver (the `getResolve`-less loader context). */
  resolveExtensions?: string[];
  options?: Record<string, unknown>;
}

const APP = '/app';

/**
 * Invoke the loader the way webpack does: `this.async()` first, result through
 * the callback. Reads star re-export targets through `loaderContext.fs`, which
 * is the branch real bundlers take.
 */
const runWrapperLoader = (
  resourcePath: string,
  source: string,
  { files = {}, resolveExtensions = ['.tsx', '.ts', '.jsx', '.js'], options = {} }: RunOptions = {}
): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const dependencies: string[] = [];
    const context = {
      resourcePath,
      addDependency: (file: string) => dependencies.push(file),
      getOptions: () => options,
      fs: {
        readFile: (file: string, callback: (error: unknown, data?: unknown) => void) => {
          const content = files[file];
          if (content === undefined) {
            callback(new Error(`ENOENT: ${file}`));
            return;
          }
          callback(null, content);
        },
      },
      getResolve: () => async (fromDir: string, request: string) => {
        for (const extension of resolveExtensions) {
          const candidate = `${fromDir}/${request.replace(/^\.\//, '')}${extension}`;
          if (candidate in files) return candidate;
        }
        throw new Error(`cannot resolve "${request}" from ${fromDir}`);
      },
      async: () => (error: Error | null, content?: string) =>
        error ? reject(error) : resolvePromise(content!),
    };
    (
      rscCssWrapperLoader as unknown as (this: unknown, content: string) => void
    ).call(context as unknown as LoaderContext<unknown>, source);
  });

/** Run without `getResolve`, so `export * from` has no resolver at all. */
const runWithoutResolver = (resourcePath: string, source: string): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const context = {
      resourcePath,
      addDependency: () => undefined,
      getOptions: () => ({}),
      async: () => (error: Error | null, content?: string) =>
        error ? reject(error) : resolvePromise(content!),
    };
    (
      rscCssWrapperLoader as unknown as (this: unknown, content: string) => void
    ).call(context as unknown as LoaderContext<unknown>, source);
  });

/**
 * The generated wrapper's actual export surface, read back out of the emitted
 * code with a real parser. Parsing also proves the wrapper is valid JS — the
 * `export var weird name = ...` bug produced a client-build syntax error.
 */
const wrapperExports = (code: string): string[] => {
  const ast = babelParse(code, { sourceType: 'module' });
  const names: string[] = [];
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      names.push('default');
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration && node.declaration.type === 'VariableDeclaration') {
        for (const declarator of node.declaration.declarations) {
          if (declarator.id.type === 'Identifier') names.push(declarator.id.name);
        }
      }
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ExportSpecifier') continue;
        names.push(
          specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : specifier.exported.value
        );
      }
    }
  }
  return names;
};

/** The names the SERVER-side client-reference stub would advertise. */
const serverExports = (
  resourcePath: string,
  source: string,
  files: Record<string, string> = {}
): Promise<string[]> =>
  collectClientExportNames(source, {
    filename: resourcePath,
    url: `file://${resourcePath}`,
    resolveExportAll: async (specifier, fromPath) => {
      const fromDir = fromPath.slice(0, fromPath.lastIndexOf('/'));
      for (const extension of ['.tsx', '.ts', '.jsx', '.js']) {
        const candidate = `${fromDir}/${specifier.replace(/^\.\//, '')}${extension}`;
        if (candidate in files) return { path: candidate, source: files[candidate]! };
      }
      throw new Error(`cannot resolve "${specifier}"`);
    },
  });

const JSX_MODULE =
  "'use client';\n" +
  'export const Card = ({ t }) => <section className="card">{t}</section>;\n' +
  'export const Badge = ({ t }) => <span className="badge">{t}</span>;\n' +
  'export default Card;\n';

describe('rscCssWrapperLoader export enumeration', () => {
  it('keeps the named exports of a JSX module (es-module-lexer dropped them)', async () => {
    const code = await runWrapperLoader(`${APP}/Card.jsx`, JSX_MODULE);

    expect(wrapperExports(code)).toEqual(['Card', 'Badge', 'default']);
    expect(code).toContain('export var Card = __rscWrap(__orig["Card"]);');
    expect(code).toContain('export var Badge = __rscWrap(__orig["Badge"]);');
  });

  it('matches the server stub for the same JSX module', async () => {
    const code = await runWrapperLoader(`${APP}/Card.jsx`, JSX_MODULE);

    expect(wrapperExports(code)).toEqual(await serverExports(`${APP}/Card.jsx`, JSX_MODULE));
  });

  it('produces the same surface for the React.createElement spelling', async () => {
    const source =
      "'use client';\n" +
      "import * as React from 'react';\n" +
      "export const Card = ({ t }) => React.createElement('section', null, t);\n" +
      "export const Badge = ({ t }) => React.createElement('span', null, t);\n" +
      'export default Card;\n';

    expect(wrapperExports(await runWrapperLoader(`${APP}/Card.js`, source))).toEqual([
      'Card',
      'Badge',
      'default',
    ]);
  });

  it('emits no default export for a TSX module that has none', async () => {
    const source =
      "'use client';\n" +
      'export const Card = ({ t }: { t: string }) => <section className="card">{t}</section>;\n' +
      'export function Badge({ t }: { t: string }) { return <span>{t}</span>; }\n';

    const code = await runWrapperLoader(`${APP}/Card.tsx`, source);

    expect(wrapperExports(code)).toEqual(['Card', 'Badge']);
    // The pre-fix loader emitted this for every unparseable module, so the
    // wrapper's only export was `undefined`.
    expect(code).not.toContain('export default');
  });

  it('excludes TypeScript type-only exports', async () => {
    const source =
      "'use client';\n" +
      'export type CardProps = { t: string };\n' +
      'export interface Theme { name: string }\n' +
      'type Internal = number;\n' +
      'export { type Internal };\n' +
      'export const Card = (p: CardProps) => <section>{p.t}</section>;\n';

    const code = await runWrapperLoader(`${APP}/Card.tsx`, source);

    expect(wrapperExports(code)).toEqual(['Card']);
  });

  it('enumerates a two-level `export * from` barrel recursively', async () => {
    const files = {
      [`${APP}/Level1.tsx`]:
        "'use client';\n" +
        "export * from './Level2';\n" +
        'export const Middle = ({ t }: { t: string }) => <b>{t}</b>;\n',
      [`${APP}/Level2.tsx`]:
        "'use client';\n" +
        'export const Deep = ({ t }: { t: string }) => <i className="deep">{t}</i>;\n' +
        'export default function Ignored() { return null; }\n',
    };
    const source = "'use client';\nexport * from './Level1';\nexport const Own = () => <hr />;\n";

    const code = await runWrapperLoader(`${APP}/Barrel.tsx`, source, { files });

    // `export *` never forwards `default`, so `Ignored` must not appear.
    expect(wrapperExports(code)).toEqual(['Deep', 'Middle', 'Own']);
    expect(wrapperExports(code)).toEqual(await serverExports(`${APP}/Barrel.tsx`, source, files));
  });

  it('fails the build on an ambiguous `export * from` diamond', async () => {
    // `./a` and `./b` each declare their OWN `Deep`, so ECMAScript — and
    // webpack, which warns `conflicting star exports for the name 'Deep'` —
    // leave `Deep` off the namespace object. Emitting
    // `export var Deep = __rscWrap(__orig['Deep'])` anyway put `undefined`
    // behind a name the manifest advertises: "Element type is invalid" at
    // render time, the same class of failure as the JSX enumeration bug.
    const files = {
      [`${APP}/a.tsx`]: 'export const Deep = ({ t }: { t: string }) => <i>{t}</i>;\n',
      [`${APP}/b.tsx`]: 'export const Deep = ({ t }: { t: string }) => <b>{t}</b>;\n',
    };
    const source = "'use client';\nexport * from './a';\nexport * from './b';\n";

    const expected = /takes "Deep" \(declared in .*a\.tsx and .*b\.tsx\)/s;
    await expect(runWrapperLoader(`${APP}/Barrel.tsx`, source, { files })).rejects.toThrow(expected);
    // The server-side stub has to refuse the same input, or the two sides would
    // disagree about the module's export surface again.
    await expect(serverExports(`${APP}/Barrel.tsx`, source, files)).rejects.toThrow(expected);
  });

  describe('star-export ambiguity matrix', () => {
    const root = "'use client';\nexport * from './a';\nexport * from './b';\n";
    const cases = [
      {
        label: 'A: independent declarations',
        a: 'export const Shared = 1;',
        b: 'export const Shared = 2;',
        fails: true,
      },
      {
        label: 'B: shared origin through star re-exports',
        a: "export * from './shared';",
        b: "export * from './shared';",
        fails: false,
      },
      {
        label: 'C: own declaration shadows conflicting stars',
        a: 'export const Shared = 1;',
        b: 'export const Shared = 2;',
        own: 'export const Shared = 3;',
        fails: false,
      },
      {
        label: 'D: named re-export leaves origin unknown',
        a: 'export const Shared = 1;',
        b: "export { Shared } from './a';",
        fails: false,
      },
      {
        // No specifier export of the enum: the Flow parser rung must
        // accept this source directly rather than falling back to TypeScript.
        label: 'E: independent Flow enums',
        a: 'export enum Shared { Active, Done }',
        b: 'export enum Shared { Open, Closed }',
        fails: true,
      },
      {
        label: 'F: renamed local declarations, including a later declaration',
        a: "const Impl = () => 'a'; export { Impl as Shared };",
        b: "export { Impl as Shared }; const Impl = () => 'b';",
        fails: true,
      },
      {
        label: 'imported aliases keep their origin unknown',
        a: "import { Shared as Impl } from './shared'; export { Impl as Shared };",
        b: "import { Shared as Impl } from './shared'; export { Impl as Shared };",
        fails: false,
      },
      {
        label: 'unrelated local name does not prove a named re-export origin',
        a: "const Shared = 1; export { Shared } from './shared';",
        b: "const Shared = 2; export { Shared } from './shared';",
        fails: false,
      },
      {
        label: 'exported aliases do not become local declarations',
        a:
          "import { Shared as Imported } from './shared'; const Local = 1; " +
          'export { Local as Imported, Imported as Shared };',
        b: 'export const Shared = 2;',
        fails: false,
        names: ['Imported', 'Shared'],
      },
    ];

    it.each(cases)('$label', async ({ a, b, own = '', fails, names = ['Shared'] }) => {
      const files = {
        [`${APP}/a.js`]: a,
        [`${APP}/b.js`]: b,
        [`${APP}/shared.js`]: 'export const Shared = 1;',
      };
      const filename = `${APP}/Barrel.js`;
      const source = root + own;
      if (fails) {
        const expected =
          'the "use client" module /app/Barrel.js takes "Shared" ' +
          '(declared in /app/a.js and /app/b.js) from more than one `export * from` target';
        await expect(runWrapperLoader(filename, source, { files })).rejects.toThrow(expected);
        await expect(serverExports(filename, source, files)).rejects.toThrow(expected);
      } else {
        const code = await runWrapperLoader(filename, source, { files });
        expect(wrapperExports(code)).toEqual(names);
        await expect(serverExports(filename, source, files)).resolves.toEqual(names);
      }
    });
  });

  it.each([
    'export const Shared = 3;',
    "export { Shared } from './a';",
    'const Local = 3; export { Local as Shared };',
  ])('allows a parent to shadow an intermediate ambiguity: %s', async (ownExport) => {
    const files = {
      [`${APP}/a.js`]: 'export const Shared = 1; export const OnlyA = 1;',
      [`${APP}/b.js`]: 'export const Shared = 2;',
      [`${APP}/mid.js`]: "export * from './a'; export * from './b';",
    };
    const filename = `${APP}/Barrel.js`;
    for (const body of [
      "export * from './mid'; " + ownExport,
      ownExport + " export * from './mid';",
    ]) {
      const source = "'use client'; " + body;
      const code = await runWrapperLoader(filename, source, { files });
      expect(wrapperExports(code).sort()).toEqual(['OnlyA', 'Shared']);
      expect((await serverExports(filename, source, files)).sort()).toEqual(['OnlyA', 'Shared']);
    }
  });

  it.each([
    {
      label: 'another unshadowed ambiguous name',
      source: "'use client'; export * from './mid'; export const Shared = 3;",
      extra: 'export const Other = 1;',
      name: 'Other',
    },
    {
      label: 'a memoized barrel reached through an unshadowed path',
      source: "'use client'; export * from './left'; export * from './right';",
      extra: '',
      name: 'Shared',
    },
  ])('still rejects $label', async ({ source, extra, name }) => {
    const files = {
      [`${APP}/a.js`]: 'export const Shared = 1; ' + extra,
      [`${APP}/b.js`]: 'export const Shared = 2; ' + extra,
      [`${APP}/mid.js`]: "export * from './a'; export * from './b';",
      [`${APP}/left.js`]: "export * from './mid'; export const Shared = 3;",
      [`${APP}/right.js`]: "export * from './mid';",
    };
    const filename = `${APP}/Barrel.js`;
    const expected =
      '/app/mid.js, re-exported by the "use client" module /app/Barrel.js, ' +
      `takes "${name}" (declared in /app/a.js and /app/b.js)`;
    await expect(runWrapperLoader(filename, source, { files })).rejects.toThrow(expected);
    await expect(serverExports(filename, source, files)).rejects.toThrow(expected);
  });

  it('aliases a non-identifier export name instead of emitting invalid syntax', async () => {
    const source = "'use client';\nconst v = 1;\nexport { v as 'weird name' };\nexport default v;\n";

    const code = await runWrapperLoader(`${APP}/Weird.js`, source);

    // `export var weird name = ...` was a client-build syntax error; parsing the
    // wrapper back is the assertion that it is not one any more.
    expect(wrapperExports(code)).toEqual(['weird name', 'default']);
    expect(code).toContain('export {__rscCssAlias0 as "weird name"};');
  });

  it('aliases reserved-word export names', async () => {
    const source =
      "'use client';\n" +
      'const impl = () => null;\n' +
      'export { impl as default, impl as class, impl as Ok };\n';

    const code = await runWrapperLoader(`${APP}/Reserved.js`, source);

    expect(wrapperExports(code).sort()).toEqual(['Ok', 'class', 'default'].sort());
  });

  it('renames its generated locals when an export name would collide with them', async () => {
    const source =
      "'use client';\n" +
      'const impl = () => null;\n' +
      'export { impl as React, impl as __orig, impl as __rscWrap };\n' +
      'export default impl;\n';

    const code = await runWrapperLoader(`${APP}/Collide.js`, source);

    // Would otherwise be `import * as React from 'react'` + `export var React = ...`.
    expect(wrapperExports(code)).toEqual(['React', '__orig', '__rscWrap', 'default']);
    expect(code).toContain("import * as _React from 'react';");
  });

  it('fails the build when an `export *` target cannot be resolved', async () => {
    const source = "'use client';\nexport * from './does-not-exist';\nexport default null;\n";

    await expect(runWrapperLoader(`${APP}/Missing.tsx`, source)).rejects.toThrow(
      /failed to read "\.\/does-not-exist" re-exported by the "use client" module .*Missing\.tsx/
    );
  });

  it('fails the build when the loader context has no resolver at all', async () => {
    const source = "'use client';\nexport * from './Other';\n";

    await expect(runWithoutResolver(`${APP}/Barrel.tsx`, source)).rejects.toThrow(
      /provides no module resolver/
    );
  });

  it('fails the build on unparseable source instead of falling back to `default`', async () => {
    const source = "'use client';\nexport const Broken = ( => ;\n";

    await expect(runWrapperLoader(`${APP}/Broken.tsx`, source)).rejects.toThrow(
      /failed to parse the "use client" module .*Broken\.tsx/
    );
  });

  it('fails the build for a module with no runtime exports', async () => {
    const source = "'use client';\nexport type Only = string;\n";

    await expect(runWrapperLoader(`${APP}/TypesOnly.ts`, source)).rejects.toThrow(
      /has no runtime exports/
    );
  });

  it('accepts proposal syntax through the parserPlugins loader option', async () => {
    const source = "'use client';\nexport const value = 1 |> % + 1;\nexport default value;\n";

    await expect(runWrapperLoader(`${APP}/Pipeline.js`, source)).rejects.toThrow(
      /failed to parse|parserPlugins/
    );
    const code = await runWrapperLoader(`${APP}/Pipeline.js`, source, {
      options: { parserPlugins: [['pipelineOperator', { proposal: 'hack', topicToken: '%' }]] },
    });
    expect(wrapperExports(code)).toEqual(['value', 'default']);
  });

  it('rejects a malformed parserPlugins loader option', async () => {
    await expect(
      runWrapperLoader(`${APP}/Card.jsx`, JSX_MODULE, { options: { parserPlugins: 'jsx' } })
    ).rejects.toThrow(/parserPlugins/);
  });

  /*
   * A tuple plugin is exactly `[name, options]`. This guard lives in the shared
   * `src/loaderExportScan.ts` and deliberately duplicates the same correction made
   * independently in #221, which still edits the pre-extraction copy in
   * `src/WebpackLoader.ts`. Keeping BOTH strict makes either merge order safe.
   *
   * The test matters because the conflict is silent: git raises a modify/delete
   * conflict in `WebpackLoader.ts`, and resolving it in favour of this PR's
   * extraction would revert #221 with no conflict marker anywhere near the
   * surviving copy. This assertion is the signal that would otherwise be missing.
   */
  it("rejects a one-element parserPlugins tuple with the loader's own message", async () => {
    const source = "'use client';\nexport const value = 1;\nexport default value;\n";

    // A `length <= 2` check accepts `['pipelineOperator']`, which then fails
    // inside @babel/parser with a plugin-specific message that `parseModule`
    // wraps in its "failed to parse" error — blaming the source file for what is
    // really a misconfigured option.
    const attempt = runWrapperLoader(`${APP}/Pipeline.js`, source, {
      options: { parserPlugins: [['pipelineOperator']] },
    });

    await expect(attempt).rejects.toThrow(
      /rscCssWrapperLoader: the `parserPlugins` option must be an array of @babel\/parser plugin names or \[name, options\] tuples\./
    );
    await expect(attempt).rejects.not.toThrow(/failed to parse/);
  });

  it('accepts a well-formed two-element parserPlugins tuple', async () => {
    const source = "'use client';\nexport const value = 1 |> % + 1;\nexport default value;\n";

    const code = await runWrapperLoader(`${APP}/Pipeline.js`, source, {
      options: { parserPlugins: [['pipelineOperator', { proposal: 'hack', topicToken: '%' }]] },
    });

    expect(wrapperExports(code)).toEqual(['value', 'default']);
  });

  it('still renders CSS links: the wrapper body is unchanged', async () => {
    const code = await runWrapperLoader(`${APP}/Card.jsx`, JSX_MODULE);

    expect(code).toContain("import * as __orig from \"/app/Card.jsx?__rsc_orig\";");
    expect(code).toContain("precedence: 'rsc-css'");
    expect(code).toContain('__RSC_CSS_HREFS__');
  });
});
