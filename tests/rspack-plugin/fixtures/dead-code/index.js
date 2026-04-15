// Entry only imports Used.js — Dead.js has "use client" but is never imported.
// It should NOT appear in the manifest (dead code elimination via module graph).
import Used from './Used';
export default Used;
