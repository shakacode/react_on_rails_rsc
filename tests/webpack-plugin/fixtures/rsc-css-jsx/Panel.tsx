'use client';
import './Panel.css';

export const Panel = ({ title }: { title: string }) => (
  <aside className="jsx-panel">{title}</aside>
);

export default Panel;
