import { hasUseClientDirective } from '../src/clientReferences';

describe('hasUseClientDirective', () => {
  it('recognizes a directive followed by code on the same line', () => {
    expect(hasUseClientDirective("'use client'; export const answer = 42;\n")).toBe(true);
  });

  it('recognizes double-quoted directives', () => {
    expect(hasUseClientDirective('"use client";\nexport default function Client() {}\n')).toBe(
      true,
    );
  });

  it('recognizes Buffer input', () => {
    expect(hasUseClientDirective(Buffer.from("'use client';\n"))).toBe(true);
  });

  it('recognizes directives after leading block comments', () => {
    expect(hasUseClientDirective("/* @generated */\n'use client';\n")).toBe(true);
  });

  it('recognizes directives at EOF without trailing newline', () => {
    expect(hasUseClientDirective("'use client'")).toBe(true);
  });

  it('recognizes directives with Windows line endings', () => {
    expect(hasUseClientDirective("'use client'\r\nexport default function Client() {}\r\n")).toBe(
      true,
    );
  });

  it('rejects same-line code without a directive semicolon', () => {
    expect(hasUseClientDirective("'use client' export const answer = 42;\n")).toBe(false);
  });

  it('ignores server modules without directives', () => {
    expect(hasUseClientDirective('export default function Server() {}\n')).toBe(false);
  });
});
