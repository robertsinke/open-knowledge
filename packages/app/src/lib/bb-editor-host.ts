const BB_EDITOR_HOST = '__OPEN_KNOWLEDGE_BB_EDITOR__';

export const BB_EDITOR_HOST_ATTRIBUTE = 'data-bb-editor-host';

function hostRoot(): HTMLElement | null {
  return globalThis.document?.documentElement ?? null;
}

export function markBbEditorHost(): void {
  (globalThis as Record<string, unknown>)[BB_EDITOR_HOST] = true;
  hostRoot()?.setAttribute(BB_EDITOR_HOST_ATTRIBUTE, '');
}

export function clearBbEditorHost(): void {
  delete (globalThis as Record<string, unknown>)[BB_EDITOR_HOST];
  hostRoot()?.removeAttribute(BB_EDITOR_HOST_ATTRIBUTE);
}

export function isBbEditorHost(): boolean {
  return (globalThis as Record<string, unknown>)[BB_EDITOR_HOST] === true;
}
