/*
 * Plain JavaScript fixture: the export forms the stock acorn-loose enumeration
 * already handled must keep working.
 *
 * Runtime exports: Header, LEGACY_NAME, alpha, gamma, delta, Renamed, default.
 * `beta` is only a destructuring path, not a binding, so it is not an export.
 */

'use client';

export function Header() {
  return null;
}

export class LEGACY_NAME {}

export const { alpha, beta: { gamma } = {}, ...delta } = {};

const internal = 1;
export { internal as Renamed };

export default function HomePage() {
  return null;
}
