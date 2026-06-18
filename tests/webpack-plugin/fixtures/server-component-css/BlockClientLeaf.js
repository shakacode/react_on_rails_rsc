'use client';

// Path (b)/(c)-via-client: a 'use client' leaf that imports the sentinel CSS.
// This is a client reference, so the plugin discovers it and collects its
// CSS sibling.
import './sentinel.css';

export default function BlockClientLeaf() {
  return 'styled block (client leaf)';
}
