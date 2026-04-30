import { something } from './SingleQuote';
'use client';
// Directive must be FIRST statement. An import above it invalidates it.
// This file should NOT be tagged.
export default something;
