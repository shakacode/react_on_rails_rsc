import * as React from 'react';
import './Styled.css';
export function Styled(props) {
  return React.createElement('div', { id: 'box', className: 'exp-box' }, props.title);
}
