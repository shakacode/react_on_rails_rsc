// Button and SettingsPage are independent 'use client' components that both
// import a shared non-client module (`shared`) carrying its own CSS. The entry
// reaches them only through the plugin's injected async blocks, and splitChunks
// forces `shared` into a chunk shared by both client-reference chunk groups —
// so the shared chunk's CSS is the broadcast vector the per-chunk fix scopes.
import { entryOnly } from './entryOnly';

export const app = [entryOnly];
