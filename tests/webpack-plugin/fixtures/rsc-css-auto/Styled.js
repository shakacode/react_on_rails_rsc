'use client';
import * as React from 'react';
import './Styled.css';
// A plain client component — it does NOT render its own <link>. The plugin's
// cssWrapper generates a wrapper that renders the CSS <link precedence> for it.
export default function Styled(props) {
  return React.createElement('div', { id: 'box', className: 'exp-box' }, props.title);
}
export const HELPER_CONSTANT = 'helper-value-42';
