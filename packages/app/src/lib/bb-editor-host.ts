const BB_EDITOR_HOST = '__OPEN_KNOWLEDGE_BB_EDITOR__';

export const BB_EDITOR_HOST_ATTRIBUTE = 'data-bb-editor-host';

export const BB_SETTINGS_PAGE_ATTRIBUTE = 'data-bb-settings-page';

function hostRoot(): HTMLElement | null {
  return globalThis.document?.documentElement ?? null;
}

export function markBbEditorHost(): void {
  (globalThis as Record<string, unknown>)[BB_EDITOR_HOST] = true;
  hostRoot()?.setAttribute(BB_EDITOR_HOST_ATTRIBUTE, '');
}

export function markBbSettingsPage(): void {
  if (typeof window === 'undefined') return;
  if (new URLSearchParams(window.location.search).get('bb-settings') !== '1') return;
  hostRoot()?.setAttribute(BB_SETTINGS_PAGE_ATTRIBUTE, '');
  if (!window.location.hash.startsWith('#settings')) window.location.hash = '#settings';
}

export function isBbSettingsPage(): boolean {
  return hostRoot()?.hasAttribute(BB_SETTINGS_PAGE_ATTRIBUTE) === true;
}

export function clearBbEditorHost(): void {
  delete (globalThis as Record<string, unknown>)[BB_EDITOR_HOST];
  hostRoot()?.removeAttribute(BB_EDITOR_HOST_ATTRIBUTE);
}

export function isBbEditorHost(): boolean {
  return (globalThis as Record<string, unknown>)[BB_EDITOR_HOST] === true;
}
