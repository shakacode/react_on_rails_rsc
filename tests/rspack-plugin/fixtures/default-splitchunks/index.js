// Initial entry: biglib must stay in main.js when splitChunks uses default async chunks.
import { label } from './biglib';

export default function readInitialDependency() {
  return label;
}
