import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createServer } from './server-factory.ts';
import { SyncEngine } from './sync-engine.ts';

describe('createServer() — skipOpenKnowledgeAutoSync', () => {
  const dirs: string[] = [];
  const servers: Array<{ destroy: () => Promise<void> }> = [];
  const start = vi.spyOn(SyncEngine.prototype, 'start');

  afterEach(async () => {
    start.mockClear();
    await Promise.all(servers.splice(0).map((server) => server.destroy()));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function boot(skipOpenKnowledgeAutoSync: boolean) {
    const projectDir = mkdtempSync(resolve(tmpdir(), 'ok-skip-auto-sync-'));
    const home = mkdtempSync(resolve(tmpdir(), 'ok-skip-auto-sync-home-'));
    dirs.push(projectDir, home);
    mkdirSync(resolve(projectDir, 'content'));
    const server = createServer({
      contentDir: resolve(projectDir, 'content'),
      projectDir,
      quiet: true,
      configHomedirOverride: home,
      ...(skipOpenKnowledgeAutoSync ? { skipOpenKnowledgeAutoSync: true } : {}),
    });
    servers.push(server);
    return server;
  }

  test('the start switch skips syncEngine.start()', async () => {
    const running = boot(false);
    await running.ready;
    expect(start).toHaveBeenCalledOnce();

    start.mockClear();
    const skipped = boot(true);
    await skipped.ready;
    expect(start).not.toHaveBeenCalled();
    expect(skipped.syncEngine).toBeNull();
  });
});
