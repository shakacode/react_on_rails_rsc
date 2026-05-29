// Entry only imports Used.js — Dead.js has "use client" but is never imported.
// Dead.js is still discovered by the plugin's FS walk and injected via addInclude,
// so it DOES appear in the manifest. This matches the webpack plugin's behavior.
import Used from './Used';
export default Used;
