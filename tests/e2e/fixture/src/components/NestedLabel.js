'use client';

import * as React from 'react';
import { formatCount } from './shared/format';
import './NestedLabel.css';

export default function NestedLabel({ theme }) {
  return React.createElement(
    'em',
    { className: 'nested-label', 'data-testid': 'nested-label' },
    formatCount('theme', theme),
  );
}
