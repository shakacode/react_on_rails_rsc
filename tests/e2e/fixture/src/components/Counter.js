'use client';

import * as React from 'react';
import { formatCount } from './shared/format';
import './Counter.css';

export default function Counter({ label, initial }) {
  const [count, setCount] = React.useState(initial);
  return React.createElement(
    'div',
    { className: 'counter', 'data-testid': 'counter' },
    React.createElement(
      'button',
      {
        'data-testid': 'counter-button',
        onClick: () => setCount((current) => current + 1),
      },
      'increment',
    ),
    React.createElement('span', { 'data-testid': 'counter-value' }, formatCount(label, count)),
  );
}
