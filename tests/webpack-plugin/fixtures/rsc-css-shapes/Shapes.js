'use client';
import * as React from 'react';
import './Shapes.css';
// default is a forwardRef component (an OBJECT, not a function) — the loader's
// __rscWrap must still wrap it so it emits its <link precedence>.
export default React.forwardRef(function Shapes(props, ref) {
  return React.createElement('div', { id: 'box', className: 'exp-box', ref }, props.title);
});
// a memo component export
export const MemoBox = React.memo(function MemoBox(props) {
  return React.createElement('div', { className: 'memo' }, props.title);
});
// a non-component export must be untouched
export const HELPER_CONSTANT = 'helper-value-42';
