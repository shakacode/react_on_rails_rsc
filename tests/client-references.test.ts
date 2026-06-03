import { hasUseClientDirective } from '../src/clientReferences';

describe('hasUseClientDirective', () => {
  it('recognizes a directive followed by code on the same line', () => {
    expect(hasUseClientDirective("'use client'; export const answer = 42;\n")).toBe(true);
  });
});
