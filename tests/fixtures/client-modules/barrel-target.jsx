/* Star re-export target for `barrel-client-module.jsx`. */

export function Card({ children }) {
  return <div>{children}</div>;
}

export const CardBody = ({ children }) => <div>{children}</div>;

export default function NotForwarded() {
  return null;
}
