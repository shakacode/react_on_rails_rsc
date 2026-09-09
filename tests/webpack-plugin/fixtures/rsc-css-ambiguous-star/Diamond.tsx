'use client';
import './Diamond.css';

// `./a` and `./b` each declare their own `Foo`, so ECMAScript (and webpack)
// drop `Foo` from this module's namespace object. Before the ambiguity check
// the generated wrapper still emitted `export var Foo = __rscWrap(__orig['Foo'])`,
// which webpack resolved to `undefined` — an "Element type is invalid" render.
export * from './a';
export * from './b';

export const Own = ({ title }: { title: string }) => <em className="own">{title}</em>;
