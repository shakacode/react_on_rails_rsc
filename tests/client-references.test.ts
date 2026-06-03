import * as acorn from 'acorn-loose';
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

  it('recognizes directives with carriage-return line endings', () => {
    expect(hasUseClientDirective("'use client'\rexport default function Client() {}\r")).toBe(
      true,
    );
  });

  it('recognizes use client after earlier directive prologue entries', () => {
    expect(hasUseClientDirective("'use strict';\n'use client';\nexport default function Client() {}\n")).toBe(
      true,
    );
  });

  it('recognizes directives followed by trailing line comments', () => {
    expect(hasUseClientDirective("'use client' // generated\nexport default function Client() {}\n")).toBe(
      true,
    );
  });

  it('rejects same-line code without a directive semicolon', () => {
    expect(hasUseClientDirective("'use client' export const answer = 42;\n")).toBe(false);
  });

  it('rejects line-comment cases where the next token continues the expression', () => {
    expect(hasUseClientDirective("'use client' // generated\n[foo].forEach(() => {});\n")).toBe(
      false,
    );
  });

  it('rejects parenthesized string expressions', () => {
    expect(hasUseClientDirective('("use client");\nexport default function Server() {}\n')).toBe(
      false,
    );
  });

  it('rejects escaped directive-like string values', () => {
    expect(
      hasUseClientDirective('"use\\u0020client";\nexport default function Server() {}\n'),
    ).toBe(false);
  });

  it('returns false when directive parsing fails', () => {
    jest.spyOn(acorn, 'parse').mockImplementationOnce(() => {
      throw new Error('parse failed');
    });

    expect(hasUseClientDirective("'use client';\n")).toBe(false);
  });

  it('ignores server modules without directives', () => {
    expect(hasUseClientDirective('export default function Server() {}\n')).toBe(false);
  });
});
