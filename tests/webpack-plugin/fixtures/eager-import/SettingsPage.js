'use client';

// Also reference the eagerly-imported Button from another client component
// so the fallback has several chunk groups to consider.
import Button from './Button';

export default function SettingsPage() {
  return 'settings:' + Button();
}
