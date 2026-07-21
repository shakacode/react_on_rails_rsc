'use client';
import * as React from 'react';
import './Styled.css';
export default function Styled(props) {
  return React.createElement('div', { id: 'box', className: 'exp-box' }, props.title);
}
export const HELPER_CONSTANT = 'helper-value-42';
