// @vitest-environment jsdom
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  isBbEditorHost,
  markBbEditorHost,
} from "../packages/app/src/lib/bb-editor-host";
import { EDITOR_ORIGIN_POLL_MS, ThreadEditor } from "./app";
import {
  canonicalWorkspaceRoot,
  deployedOriginKey,
  editorOriginFrom,
  initCliArgs,
  mcpUrlKey,
  pluginRepoRoot,
  projectMarkerPath,
  readDeployedOriginValue,
  readWorkspaceServerLock,
  resolveEditorOrigin,
  runWorkspaceInit,
  stopWorkspaceServerLockReader,
  type ProjectServerDeps,
} from "./server";

const execFileAsync = promisify(execFile);
const app = await loadPluginApp(() => import("./app"));
const holders: ChildProcess[] = [];

const HOLD_SOURCE = `
import { acquireProcessLock, updateProcessLockPort } from "./src/process-lock.ts";
import { resolveLockDir } from "./src/config/paths.ts";
const root = process.argv[1];
const url = process.argv[2];
const port = Number(process.argv[3]);
const lockDir = resolveLockDir(root);
acquireProcessLock({
  lockName: "server",
  lockDir,
  metadata: { port: 0, url, worktreeRoot: root },
});
updateProcessLockPort({ lockName: "server", lockDir, port, url });
setInterval(() => {}, 1000000);
`;

function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `ok-bb-${name}-`));
}

function holdLock(root: string, url: string, port: number): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      "--import",
      join(pluginRepoRoot(), "node_modules/tsx/dist/esm/index.mjs"),
      "--input-type=module",
      "-e",
      HOLD_SOURCE,
      "--",
      root,
      url,
      String(port),
    ],
    { cwd: join(pluginRepoRoot(), "packages/server"), stdio: "ignore" },
  );
  holders.push(child);
  return child;
}

async function waitForOrigin(root: string, origin: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const lock = await readWorkspaceServerLock(root);
    if (lock.state === "ready" && lock.origin === origin) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`live origin ${origin} was not recorded for ${root}`);
}

function marker(root: string, body = "content:\n  dir: .\n"): void {
  mkdirSync(join(root, ".ok"), { recursive: true });
  writeFileSync(projectMarkerPath(root), body);
}

function deps(overrides: Partial<ProjectServerDeps> = {}): ProjectServerDeps {
  return {
    markerExists: () => true,
    readLiveLock: async () => ({ state: "absent" }),
    deployedOrigin: async () => undefined,
    runInit: async () => {
      throw new Error("init");
    },
    runStart: async () => {
      throw new Error("start");
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

afterAll(() => {
  stopWorkspaceServerLockReader();
  for (const child of holders) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  vi.useRealTimers();
});

describe("OpenKnowledge editor plugin", () => {
  it("is the GPL editor package and points at this fork's app source", () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginRepoRoot(), "bb-plugin/package.json"), "utf8"),
    ) as { license: string; bb: { app?: string } };
    const source = readFileSync(join(pluginRepoRoot(), "bb-plugin/app.tsx"), "utf8");
    expect(manifest.license).toBe("GPL-3.0-or-later");
    expect(manifest.bb.app).toBe("./app.tsx");
    expect(source).toContain("../packages/app/src");
    expect(source).not.toContain("TerminalSection");
    expect(source).not.toContain("SyncSection");
    expect(source).not.toContain("localhost:5173");
  });

  it("registers editor settings without a terminal or OpenKnowledge sync control", async () => {
    expect(app.settingsSections).toHaveLength(1);
    expect(app.settingsSections[0]?.title).toBe("Editor");
    const slot = renderSlot(app.settingsSections[0]!, {});
    await slot.findByText(/The terminal is omitted/u);
    expect(slot.container.textContent).toContain("GitHub sync is a BB setting");
    expect(slot.container.textContent).not.toMatch(/terminal settings/iu);
  });

  it("marks this page as the BB editor host", () => {
    markBbEditorHost();
    expect(isBbEditorHost()).toBe(true);
  });

  it("loads bb.html on the workspace origin", async () => {
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_editor", environment: { id: "env_editor" } },
      {
        rpc: {
          editorOrigin: () => ({
            origin: "http://127.0.0.1:4173",
            editorUrl: "http://127.0.0.1:4173/bb.html",
            mcpUrl: "http://127.0.0.1:4173/mcp",
            source: "local" as const,
          }),
        },
        sdk: {
          environments: {
            get: async () => ({ path: "/tmp/workspace-a" }) as never,
          },
        },
      },
    );
    const editor = await slot.findByTitle("OpenKnowledge editor");
    expect(editor.getAttribute("src")).toBe("http://127.0.0.1:4173/bb.html");
  });

  it("does not load an editor when the thread has no workspace", async () => {
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_empty", environment: null },
      {
        rpc: {
          editorOrigin: () => {
            throw new Error("origin requested");
          },
        },
      },
    );
    await slot.findByText("No workspace is open for this editor.");
    expect(slot.container.querySelector("iframe")).toBeNull();
  });

  it("asks for the origin again while the surface is mounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_poll", environment: { id: "env_poll" } },
      {
        rpc: {
          editorOrigin: () => {
            calls += 1;
            return {
              origin: "http://127.0.0.1:4174",
              editorUrl: "http://127.0.0.1:4174/bb.html",
              mcpUrl: "http://127.0.0.1:4174/mcp",
              source: "local" as const,
            };
          },
        },
        sdk: {
          environments: {
            get: async () => ({ path: "/tmp/workspace-poll" }) as never,
          },
        },
      },
    );
    await slot.findByTitle("OpenKnowledge editor");
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(EDITOR_ORIGIN_POLL_MS);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});

describe("workspace project server", () => {
  it("stores a deployed origin per workspace root", () => {
    const first = tempDir("key-a");
    const second = tempDir("key-b");
    expect(deployedOriginKey(first)).not.toBe(deployedOriginKey(second));
    expect(mcpUrlKey(first)).toBe(`mcp-url:${canonicalWorkspaceRoot(first)}`);
    expect(readDeployedOriginValue("  https://kb.example  ")).toBe("https://kb.example");
    expect(readDeployedOriginValue("  ")).toBeUndefined();
    expect(editorOriginFrom("https://kb.example/app", "deployed").editorUrl).toBe(
      "https://kb.example/bb.html",
    );
  });

  it("gives a new workspace a marker and a local origin", async () => {
    const root = tempDir("new");
    const origin = "http://127.0.0.1:4311";
    let inits = 0;
    const result = await resolveEditorOrigin(
      root,
      deps({
        markerExists: () => existsSync(projectMarkerPath(root)),
        readLiveLock: readWorkspaceServerLock,
        deployedOrigin: async () => undefined,
        runInit: async (workspace) => {
          inits += 1;
          await runWorkspaceInit(workspace, isolatedHome());
        },
        runStart: async (workspace) => {
          holdLock(workspace, origin, 4311);
          await waitForOrigin(workspace, origin);
        },
      }),
    );
    expect(inits).toBe(1);
    expect(existsSync(projectMarkerPath(root))).toBe(true);
    expect(result).toMatchObject({
      origin,
      editorUrl: `${origin}/bb.html`,
      mcpUrl: `${origin}/mcp`,
      source: "local",
    });
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".cursor", "mcp.json"))).toBe(false);
  }, 120_000);

  it("does not init a workspace that already has .ok/config.yml", async () => {
    const root = tempDir("keep");
    const body = "content:\n  dir: notes\n";
    marker(root, body);
    mkdirSync(join(root, "notes"));
    const home = tempDir("keep-home");
    mkdirSync(join(home, ".cursor"));
    const ran = await runWorkspaceInit(root, { ...process.env, HOME: home, USERPROFILE: home });
    expect(readFileSync(projectMarkerPath(root), "utf8")).toBe(body);
    expect(ran.stderr).not.toContain("Where should the MCP server be configured");
    expect(ran.stderr).not.toContain("How do you want to handle OpenKnowledge config files");
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".cursor", "skills", "open-knowledge", "SKILL.md"))).toBe(false);
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    let inits = 0;
    const result = await resolveEditorOrigin(
      root,
      deps({
        markerExists: () => existsSync(projectMarkerPath(root)),
        deployedOrigin: async () => "https://notes.example",
        runInit: async () => {
          inits += 1;
        },
      }),
    );
    expect(inits).toBe(0);
    expect(readFileSync(projectMarkerPath(root), "utf8")).toBe(body);
    expect(result.origin).toBe("https://notes.example");
    expect(result.editorUrl).toBe("https://notes.example/bb.html");
  }, 120_000);

  it("scaffolds a nested workspace at that root", async () => {
    const parent = tempDir("ancestor");
    const home = tempDir("ancestor-home");
    mkdirSync(join(home, ".cursor"));
    await execFileAsync("git", ["init", "-b", "main", parent]);
    const parentConfig = "content:\n  dir: ancestor-notes\n";
    marker(parent, parentConfig);
    const nested = join(parent, "nested");
    mkdirSync(nested);
    const ran = await runWorkspaceInit(nested, { ...process.env, HOME: home, USERPROFILE: home });
    const summary = JSON.parse(ran.stdout) as {
      projectRoot: string;
      gitRootPromoted: boolean;
      didGitInit: boolean;
      mcpAction: string;
    };
    expect(summary.projectRoot).toBe(realpathSync(nested));
    expect(summary.gitRootPromoted).toBe(false);
    expect(summary.didGitInit).toBe(false);
    expect(summary.mcpAction).toBe("skipped-flag");
    expect(existsSync(projectMarkerPath(nested))).toBe(true);
    expect(readFileSync(projectMarkerPath(parent), "utf8")).toBe(parentConfig);
    expect(readFileSync(projectMarkerPath(nested), "utf8")).not.toContain("ancestor-notes");
    expect(existsSync(join(nested, ".git"))).toBe(false);
    expect(existsSync(join(nested, ".mcp.json"))).toBe(false);
    expect(existsSync(join(nested, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(join(nested, ".cursor", "skills", "open-knowledge", "SKILL.md"))).toBe(false);
    expect(ran.stderr).not.toContain("Where should the MCP server be configured");
    expect(ran.stderr).not.toContain("How do you want to handle OpenKnowledge config files");
    expect(initCliArgs).toEqual([
      "init",
      "--project-root",
      "cwd",
      "--no-mcp",
      "--no-skills",
      "--no-project-skills",
      "--local-only",
      "--json",
    ]);
  }, 120_000);

  it("resolves two workspace roots to two origins", async () => {
    const first = tempDir("root-a");
    const second = tempDir("root-b");
    marker(first);
    marker(second);
    const firstOrigin = "http://127.0.0.1:4312";
    const secondOrigin = "http://127.0.0.1:4313";
    holdLock(first, firstOrigin, 4312);
    holdLock(second, secondOrigin, 4313);
    await waitForOrigin(first, firstOrigin);
    await waitForOrigin(second, secondOrigin);
    const [left, right] = await Promise.all([
      resolveEditorOrigin(
        first,
        deps({
          readLiveLock: readWorkspaceServerLock,
          deployedOrigin: async () => undefined,
        }),
      ),
      resolveEditorOrigin(
        second,
        deps({
          readLiveLock: readWorkspaceServerLock,
          deployedOrigin: async () => undefined,
        }),
      ),
    ]);
    expect(left.origin).toBe(firstOrigin);
    expect(right.origin).toBe(secondOrigin);
    expect(left.origin).not.toBe(right.origin);
  }, 60_000);

  it("uses a deployed origin without a local lock", async () => {
    const root = tempDir("deployed");
    marker(root);
    const result = await resolveEditorOrigin(
      root,
      deps({
        deployedOrigin: async () => "https://kb.example",
        readLiveLock: async () => {
          throw new Error("lock");
        },
        runStart: async () => {
          throw new Error("start");
        },
      }),
    );
    expect(result).toMatchObject({
      origin: "https://kb.example",
      editorUrl: "https://kb.example/bb.html",
      mcpUrl: "https://kb.example/mcp",
      source: "deployed",
    });
    expect(existsSync(join(root, ".ok", "local", "server.lock"))).toBe(false);
  });

  it("does not treat a stale lock with a dead pid as started", async () => {
    const root = tempDir("stale");
    marker(root);
    const lockDir = join(root, ".ok", "local");
    mkdirSync(lockDir);
    const staleUrl = "http://127.0.0.1:3999";
    writeFileSync(
      join(lockDir, "server.lock"),
      JSON.stringify({
        pid: 99_999_999,
        hostname: hostname(),
        port: 3999,
        url: staleUrl,
        startedAt: new Date().toISOString(),
        worktreeRoot: root,
      }),
    );
    expect(await readWorkspaceServerLock(root)).toEqual({ state: "absent" });
    expect(existsSync(join(lockDir, "server.lock"))).toBe(false);
    let starts = 0;
    const replacement = "http://127.0.0.1:4314";
    const result = await resolveEditorOrigin(
      root,
      deps({
        readLiveLock: async () => {
          const live = await readWorkspaceServerLock(root);
          if (live.state === "absent" && starts === 0) return { state: "absent" };
          return { state: "ready", origin: replacement };
        },
        runStart: async () => {
          starts += 1;
        },
      }),
    );
    expect(starts).toBe(1);
    expect(result.origin).toBe(replacement);
    expect(result.origin).not.toBe(staleUrl);
  }, 60_000);

  it("returns the live lock origin without starting again", async () => {
    const root = tempDir("reuse");
    marker(root);
    const origin = "http://127.0.0.1:4315";
    holdLock(root, origin, 4315);
    await waitForOrigin(root, origin);
    let starts = 0;
    const result = await resolveEditorOrigin(
      root,
      deps({
        readLiveLock: readWorkspaceServerLock,
        runStart: async () => {
          starts += 1;
        },
      }),
    );
    expect(starts).toBe(0);
    expect(result.origin).toBe(origin);
    expect(result.editorUrl).toBe(`${origin}/bb.html`);
  }, 60_000);

  it("starts again when the live holder is gone", async () => {
    const root = tempDir("restart");
    marker(root);
    let phase: "live" | "gone" | "replaced" = "live";
    let starts = 0;
    const readLiveLock = async () => {
      if (phase === "live") return { state: "ready" as const, origin: "http://127.0.0.1:4316" };
      if (phase === "gone") return { state: "absent" as const };
      return { state: "ready" as const, origin: "http://127.0.0.1:4317" };
    };
    const first = await resolveEditorOrigin(root, deps({ readLiveLock }));
    expect(first.origin).toBe("http://127.0.0.1:4316");
    phase = "gone";
    const second = await resolveEditorOrigin(
      root,
      deps({
        readLiveLock: async () => {
          const lock = await readLiveLock();
          return lock;
        },
        runStart: async () => {
          starts += 1;
          phase = "replaced";
        },
      }),
    );
    expect(starts).toBe(1);
    expect(second.origin).toBe("http://127.0.0.1:4317");
  });
});

function isolatedHome(): NodeJS.ProcessEnv {
  const home = tempDir("init-home");
  return { ...process.env, HOME: home, USERPROFILE: home };
}
