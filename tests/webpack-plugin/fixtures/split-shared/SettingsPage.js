'use client';

import Button from './Button';
import { settingsOnly } from './settingsOnly';

export default function SettingsPage() {
  return 'settings:' + Button() + settingsOnly;
}
