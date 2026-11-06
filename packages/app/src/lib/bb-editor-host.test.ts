import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../globals.css'), 'utf8');
const hostAt = css.indexOf('html[data-bb-editor-host]');
const beforeHost = css.slice(0, hostAt);
const host = css.slice(hostAt);

const BB_UI_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New"';

describe('BB editor host tokens', () => {
  test('the host uses BB background, text, type size, and UI monospace, and keeps JetBrains Mono for code', () => {
    expect(host).toContain('--canvas: oklch(1 0 0)');
    expect(host).toContain('--ink: oklch(0.3211 0 0)');
    expect(host).toContain('--background: var(--canvas)');
    expect(host).toContain('--foreground: var(--ink)');
    expect(host).toContain('--text-sm: 0.8125rem');
    expect(host).toContain('--text-base: 0.9375rem');
    expect(host).toContain(BB_UI_MONO);
    expect(host).toContain('--font-mono:');
    expect(host).toContain('--font-code: "JetBrains Mono Variable", monospace');
    expect(host).toContain('--canvas: oklch(0.195 0 0)');
    expect(host).toContain('--ink: oklch(0.81 0 0)');
    expect(host).toContain('--border: color-mix(in oklch, var(--ink) 14%, var(--canvas))');
    expect(host).toContain('--sidebar: color-mix(in oklch, var(--ink) 2.2%, var(--canvas))');
  });

  test('without the host attribute the editor tokens stay as they are', () => {
    expect(beforeHost).toContain('--background: oklch(1 0 0)');
    expect(beforeHost).toContain('--foreground: oklch(0.145 0 0)');
    expect(beforeHost).toContain('--font-ui-mono: "JetBrains Mono Variable", monospace');
    expect(beforeHost).not.toContain('--ink:');
    expect(beforeHost).not.toContain('--text-sm: 0.8125rem');
    expect(beforeHost).not.toContain(BB_UI_MONO);
  });
});
