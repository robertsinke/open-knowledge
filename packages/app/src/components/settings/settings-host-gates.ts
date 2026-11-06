import { isBbEditorHost } from '@/lib/bb-editor-host';

export function isOkDesktopHost(): boolean {
  return typeof window !== 'undefined' && window.okDesktop != null;
}

export function isTerminalSettingsAvailable(): boolean {
  if (isBbEditorHost()) return false;
  return isOkDesktopHost() && window.okDesktop?.config.ptyAvailable === true;
}

export function isSpellcheckLanguageSelectionAvailable(): boolean {
  return isOkDesktopHost() && window.okDesktop?.platform !== 'darwin';
}
