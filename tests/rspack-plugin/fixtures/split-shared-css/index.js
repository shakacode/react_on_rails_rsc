// Button and SettingsPage are independent 'use client' components that both
// import a shared non-client module (`shared`) carrying its own CSS. The entry
// reaches them only through the plugin's injected client-reference imports,
// and splitChunks forces `shared` into an async chunk shared by both
// client-reference chunk groups — the #188 shape whose CSS must be hinted for
// both references (nothing else delivers it).
import { entryOnly } from './entryOnly';

export const app = [entryOnly];
