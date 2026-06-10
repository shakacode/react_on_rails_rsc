// The entry intentionally imports no client component: Button and
// SettingsPage reach this bundle only through the plugin's injected async
// blocks, so splitChunks can move Button into a chunk shared by both
// client-reference chunk groups (the issue #22 table scenario).
import { entryOnly } from './entryOnly';

export const app = [entryOnly];
