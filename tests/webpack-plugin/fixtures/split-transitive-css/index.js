// Page and Other are 'use client' references that both import Block, a plain
// dependency module carrying Block.css. splitChunks moves Block.js into a
// shared JS chunk between both client-reference groups, while
// MiniCssExtract keeps Block.css in the per-reference sibling chunks. The
// plugin must recover that CSS by scanning all modules in each chunk rather
// than only the client references.
import { entryOnly } from './entryOnly';

export const app = [entryOnly];
