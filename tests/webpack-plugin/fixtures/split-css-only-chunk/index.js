// Button is reached only through the plugin-created client-reference async
// block. A css/mini-extract SplitChunks cache group moves Button.css into a
// CSS-only sibling chunk in that block's chunk group.
import { entryOnly } from './entryOnly';

export const app = [entryOnly];
