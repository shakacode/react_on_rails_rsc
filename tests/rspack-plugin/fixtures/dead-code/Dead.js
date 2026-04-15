'use client';
// This file has "use client" but nothing imports it — rspack won't parse it,
// our loader won't tag it, it must not appear in the manifest.
export default function Dead() {
  return 'dead';
}
