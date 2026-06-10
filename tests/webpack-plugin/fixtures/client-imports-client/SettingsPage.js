'use client';

// A client component importing another client component: without
// splitChunks, Button's module is duplicated into this component's chunk,
// so Button's module appears in two chunk groups.
import Button from './Button';

export default function SettingsPage() {
  return 'settings:' + Button();
}
