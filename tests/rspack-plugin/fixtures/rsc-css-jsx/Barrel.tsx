'use client';
import './Barrel.css';

// Two-level `export * from` chain: Barrel -> Level1 -> Level2. The pre-fix
// wrapper resolved star targets ONE level, so `Deep` never reached the
// generated wrapper even though the server-side client reference advertised it.
export * from './Level1';

export const Own = ({ title }: { title: string }) => <em className="jsx-own">{title}</em>;
