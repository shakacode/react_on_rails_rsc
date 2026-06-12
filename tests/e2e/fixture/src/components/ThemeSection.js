'use client';

import * as React from 'react';
import NestedLabel from './NestedLabel';
import './ThemeSection.css';

// A client component that renders ANOTHER client component — the nested
// "use client" case. NestedLabel is itself discovered as a client
// reference, so it appears in the manifest in its own right while also
// being bundled into this component's chunk group.
export default function ThemeSection({ theme }) {
  return React.createElement(
    'section',
    { className: 'theme-section', 'data-testid': 'theme-section' },
    React.createElement('h2', null, 'Theme'),
    React.createElement(NestedLabel, { theme }),
  );
}
