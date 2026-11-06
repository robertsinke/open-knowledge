import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ConfigSchema } from '@inkeep/open-knowledge-server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bootStartServer, startCommand } from './start.ts';

const bootCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@inkeep/open-knowledge-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inkeep/open-knowledge-server')>();
  return {
    ...actual,
    bootServer: (opts: Record<string, unknown>) => {
      bootCalls.push(opts);
      return {
        httpServer: {},
        destroy: async () => {},
        lockDir: '',
        contentDir: '',
        port: 1,
        ready: Promise.resolve(),
        degraded: [],
      };
    },
  };
});

describe('--no-auto-sync', () => {
  let tmpDir: string;
  let sigint: NodeJS.SignalsListener[];
  let sigterm: NodeJS.SignalsListener[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(resolve(tmpdir(), 'ok-start-no-auto-sync-'));
    const okDir = resolve(tmpDir, '.ok');
    mkdirSync(okDir, { recursive: true });
    writeFileSync(resolve(okDir, 'config.yml'), '', 'utf-8');
    writeFileSync(resolve(okDir, '.gitignore'), '', 'utf-8');
    bootCalls.length = 0;
    sigint = process.listeners('SIGINT');
    sigterm = process.listeners('SIGTERM');
  });

  afterEach(async () => {
    for (const listener of process.listeners('SIGINT')) {
      if (!sigint.includes(listener)) process.removeListener('SIGINT', listener);
    }
    for (const listener of process.listeners('SIGTERM')) {
      if (!sigterm.includes(listener)) process.removeListener('SIGTERM', listener);
    }
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('bootStartServer forwards the switch only when it is set', async () => {
    const skipped = await bootStartServer({
      config: ConfigSchema.parse({}),
      cwd: tmpDir,
      host: '127.0.0.1',
      skipAutoInit: true,
      skipOpenKnowledgeAutoSync: true,
    });
    await skipped.destroy();
    expect(bootCalls[0]?.skipOpenKnowledgeAutoSync).toBe(true);

    const normal = await bootStartServer({
      config: ConfigSchema.parse({}),
      cwd: tmpDir,
      host: '127.0.0.1',
      skipAutoInit: true,
    });
    await normal.destroy();
    expect(bootCalls[1]).not.toHaveProperty('skipOpenKnowledgeAutoSync');
  });

  test('ok start --no-auto-sync reaches the server switch', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code ?? 0}`);
    }) as never);

    await startCommand(() => ConfigSchema.parse({})).parseAsync(
      ['--no-auto-sync', '--no-open-browser'],
      { from: 'user' },
    );

    expect(exitSpy).not.toHaveBeenCalled();
    expect(bootCalls.at(-1)?.skipOpenKnowledgeAutoSync).toBe(true);
  });
});
