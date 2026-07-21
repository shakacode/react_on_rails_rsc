'use client';
import * as React from 'react';
import './Foo.css';
export default function Foo(props) {
  return React.createElement('div', { id: 'box', className: 'exp-box' }, props.title);
}
export const HELPER_CONSTANT = 'helper-value-42';
