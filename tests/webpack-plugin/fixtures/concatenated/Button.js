'use client';

// helper.js is imported only here, making it a module-concatenation
// candidate: with optimization.concatenateModules, webpack hoists it into a
// ConcatenatedModule rooted at this file.
import { helper } from './helper';

export default function Button() {
  return 'button:' + helper();
}
