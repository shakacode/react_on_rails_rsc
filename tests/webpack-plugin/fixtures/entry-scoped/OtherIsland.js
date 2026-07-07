'use client';

// Discovered by the filesystem walk and injected through the Flight runtime,
// but imported by NO entry: it must appear in the manifest (parity) while
// appearing in no entry's entry-scoped reference list (the pollution guard —
// the traversal must not walk through the runtime module's injected imports).
export default function OtherIsland() {
  return 'other island';
}
