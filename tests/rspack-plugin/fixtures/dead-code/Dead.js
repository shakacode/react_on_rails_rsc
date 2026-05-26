'use client';
// This file has "use client" but nothing imports it. The plugin's FS walk
// discovers it and addInclude injects it into the module graph, so it DOES
// appear in the manifest for both client and server bundles.
export default function Dead() {
  return 'dead';
}
