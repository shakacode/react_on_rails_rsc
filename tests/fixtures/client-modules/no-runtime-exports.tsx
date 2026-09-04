/*
 * A `"use client"` module whose only exports are erased by TypeScript. Nothing
 * can reference it from a server component, so the loader must fail the build
 * instead of emitting an empty module.
 */

'use client';

export type ClientOnlyProps = {
  label: string;
};

export interface ClientOnlyHandle {
  focus(): void;
}
