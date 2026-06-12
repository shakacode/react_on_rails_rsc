// Plain shared module (no directive). Imported by both Counter and
// NestedLabel so the client build's splitChunks cacheGroup can force it
// into a chunk shared by multiple client-reference chunk groups.
export const formatCount = (label, value) => `${label}: ${value}`;
