export const getGeneratedChunkName = (chunkName: string, file: string, index: number): string =>
  chunkName
    .replace(/\[index\]/g, String(index))
    .replace(/\[request\]/g, file.replace(/[^a-zA-Z0-9_]/g, '_'));

// ── directive detection (shared with the plugin FS walk) ──
export { hasUseClientDirective } from '../clientReferences';
