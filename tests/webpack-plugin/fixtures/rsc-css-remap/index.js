// Import the wrapper so it is bundled (the plugin also injects an async block for
// the 'use client' Foo.js it discovers). The manifest is remapped in the test so
// Foo's client reference resolves to Foo.wrapper.js instead of Foo.js.
import './Foo.wrapper.js';
export const app = 'rsc-css-remap';
