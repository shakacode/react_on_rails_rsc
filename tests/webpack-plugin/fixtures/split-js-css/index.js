// Button and Other are both 'use client'. Other imports Button, so Button's
// JS module is shared between two client-reference chunk groups; splitChunks
// (matching only `Button.js`) moves that JS into a shared chunk while
// MiniCssExtract leaves Button.css in the per-reference sibling chunk. Button's
// own CSS thus lands in a chunk that does NOT contain Button's module — the
// #112 sibling-chunk case.
import { entryOnly } from './entryOnly';

export const app = [entryOnly];
