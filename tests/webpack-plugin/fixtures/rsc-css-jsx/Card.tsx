'use client';
import './Card.css';

// Written in real JSX on purpose: `es-module-lexer` throws on
// `<section className="...">{...}</section>`, and the cssWrapper loader sees
// this file RAW (it is requested with a `!!` prefix, which disables every other
// loader). Before the fix the wrapper fell back to `['default']` and both named
// exports disappeared from the module the client manifest points at.
export const Card = ({ title }: { title: string }) => (
  <section className="jsx-card">{title}</section>
);

export const Badge = ({ title }: { title: string }) => <span className="jsx-badge">{title}</span>;

export type CardProps = { title: string };

export default Card;
