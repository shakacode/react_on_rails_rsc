// Default `main` entry: reaches TinyIsland transitively through a plain
// server module, so the entry-scoped asset must list TinyIsland for `main`.
import { renderSection } from './ServerSection';

export const app = renderSection();
