// Plain server module between the entry and the client reference — the
// traversal must follow this edge to find TinyIsland transitively.
import TinyIsland from './TinyIsland';

export function renderSection() {
  return ['section', TinyIsland];
}
