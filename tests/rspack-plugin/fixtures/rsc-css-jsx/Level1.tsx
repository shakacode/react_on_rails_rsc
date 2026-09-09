// No `'use client'` directive: this is re-exported BY the barrel, it is not a
// client reference of its own.
export * from './Level2';

export const Middle = ({ title }: { title: string }) => <b className="jsx-middle">{title}</b>;
