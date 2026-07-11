'use client';

import './SettingsPage.css';
import { shared } from './shared';
import { settingsOnly } from './settingsOnly';

export default function SettingsPage() {
  return 'settings:' + shared + settingsOnly;
}
