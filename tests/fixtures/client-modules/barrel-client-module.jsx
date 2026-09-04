/*
 * Barrel fixture: `export * from` must be resolved and enumerated, and
 * `export * as ns from` must contribute the namespace binding itself.
 *
 * Runtime exports: Card, CardBody, widgets, default.
 * `barrel-target`'s default export is NOT forwarded by `export *`.
 */

'use client';

export * from './barrel-target';
export * as widgets from './barrel-target';

export default function Barrel() {
  return null;
}
