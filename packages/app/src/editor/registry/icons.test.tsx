import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test } from 'vitest';
import { clearBbEditorHost, markBbEditorHost } from '@/lib/bb-editor-host';
import { FolderOpen, Settings } from '@/lib/host-icons';
import { resolveIcon } from './icons.ts';

afterEach(() => {
  clearBbEditorHost();
});

function markup(icon: ReturnType<typeof resolveIcon>): string {
  return renderToStaticMarkup(createElement(icon));
}

describe('BB editor host icons', () => {
  test('a header icon and a file-tree icon use Lucide off the host and Hugeicons on it', () => {
    expect(markup(Settings)).toContain('data-icon-set="lucide"');
    expect(markup(FolderOpen)).toContain('data-icon-set="lucide"');
    markBbEditorHost();
    expect(markup(Settings)).toContain('data-icon-set="hugeicons"');
    expect(markup(Settings)).toContain('data-icon-name="Settings"');
    expect(markup(FolderOpen)).toContain('data-icon-set="hugeicons"');
    expect(markup(FolderOpen)).toContain('data-icon-name="FolderOpen"');
  });

  test('a document icon with a Hugeicons match uses it on the host', () => {
    markBbEditorHost();
    const html = markup(resolveIcon('FileText'));
    expect(html).toContain('data-icon-set="hugeicons"');
    expect(html).toContain('data-icon-name="FileText"');
  });

  test('a document icon with no Hugeicons match still renders a Lucide icon', () => {
    markBbEditorHost();
    const html = markup(resolveIcon('AlignCenter'));
    expect(html).toContain('data-icon-set="lucide"');
    expect(html).toContain('data-icon-name="AlignCenter"');
    expect(html).toContain('<path');
  });
});
