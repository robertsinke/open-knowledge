// @vitest-environment jsdom
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cleanup, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  bbCommentChatAdd,
  bbCommentChatComposer,
  commentChatContextFromId,
} from "./comment-chat";
import {
  bbDeployedOriginCurrent,
  bbDeployedOriginRead,
  bbDeployedOriginSet,
} from "./deployed-origin";
import { EDITOR_ORIGIN_POLL_MS, editorDocumentHash, ThreadEditor } from "./app";
import plugin, {
  canonicalWorkspaceRoot,
  corpusDirectory,
  GENERAL_CORPUS_DIRECTORY,
  deployedOriginKey,
  editorOriginFrom,
  initCliArgs,
  startCliArgs,
  mcpUrlKey,
  pluginRepoRoot,
  projectMarkerPath,
  readDeployedOriginValue,
  readWorkspaceServerLock,
  resolveEditorOrigin,
  runWorkspaceInit,
  stopWorkspaceServerLockReader,
  writeDeployedOrigin,
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
    ) as {
      license: string;
      bb: { app?: string };
      engines: { bbPluginSdk: string };
      devDependencies: { "@get-bb/plugin-sdk": string };
    };
    const source = readFileSync(join(pluginRepoRoot(), "bb-plugin/app.tsx"), "utf8");
    expect(manifest.license).toBe("GPL-3.0-or-later");
    expect(manifest.engines.bbPluginSdk).toBe(">=0.6.104");
    expect(manifest.devDependencies["@get-bb/plugin-sdk"]).toBe("0.6.104");
    expect(manifest.bb.app).toBe("./app.tsx");
    expect(source).not.toContain("../packages/app/");
    expect(source).not.toContain("TerminalSection");
    expect(source).not.toContain("SyncSection");
    expect(source).not.toContain("localhost:5173");
  });

  it("registers editor settings as this project's OpenKnowledge settings", async () => {
    expect(app.settingsSections).toHaveLength(1);
    expect(app.settingsSections[0]?.title).toBe("Editor");
    const slot = renderSlot(app.settingsSections[0]!, {}, { context: { projectId: null } });
    await slot.findByText("No project is open for these settings.");
    expect(slot.container.textContent).not.toMatch(/terminal settings/iu);
  });

  it("loads the native settings menu inside BB settings for the open project", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        context: { projectId: "proj_editor" },
        rpc: {
          editorOrigin: () => ({
            origin: "http://127.0.0.1:4173",
            editorUrl: "http://127.0.0.1:4173/bb.html",
            mcpUrl: "http://127.0.0.1:4173/mcp",
            source: "local" as const,
          }),
        },
      },
    );
    const frame = await slot.findByTitle("OpenKnowledge settings");
    expect(frame.getAttribute("src")).toBe("http://127.0.0.1:4173/bb.html?bb-settings=1#settings");
  });

  it("loads bb.html for the BB project, not the thread workspace", async () => {
    let requested: unknown;
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_editor", environment: { id: "env_editor" } },
      {
        context: { projectId: "proj_editor", threadId: "thr_editor" },
        rpc: {
          editorOrigin: (input) => {
            requested = input;
            return {
              origin: "http://127.0.0.1:4173",
              editorUrl: "http://127.0.0.1:4173/bb.html",
              mcpUrl: "http://127.0.0.1:4173/mcp",
              source: "local" as const,
            };
          },
        },
      },
    );
    const editor = await slot.findByTitle("OpenKnowledge editor");
    expect(editor.getAttribute("src")).toBe("http://127.0.0.1:4173/bb.html");
    expect(editor.parentElement?.style.minHeight).toBe("0px");
    expect(requested).toEqual({ projectId: "proj_editor" });
    expect(slot.inspection.sdkCalls).toEqual([]);
  });

  it("opens a workspace markdown file on that project's document", async () => {
    expect(app.fileOpeners[0]).toMatchObject({
      id: "editor",
      title: "OpenKnowledge Editor",
      extensions: ["md", "mdx", "markdown"],
    });
    const slot = renderSlot(
      app.fileOpeners[0]!,
      {
        path: "notes/a.md",
        source: {
          kind: "workspace",
          environmentId: "env_notes",
          projectId: "prj_notes",
          threadId: "thr_notes",
        },
        Original: () => <p>Original preview</p>,
      },
      {
        rpc: {
          editorOrigin: (input) => {
            expect(input).toEqual({ projectId: "prj_notes" });
            return {
              origin: "http://127.0.0.1:4242",
              editorUrl: "http://127.0.0.1:4242/bb.html",
              mcpUrl: "http://127.0.0.1:4242/mcp",
              source: "local" as const,
            };
          },
        },
      },
    );
    const editor = await slot.findByTitle("OpenKnowledge editor");
    expect(editor.getAttribute("src")).toBe(
      `http://127.0.0.1:4242/bb.html${editorDocumentHash("notes/a.md")}`,
    );
    expect(editorDocumentHash("notes/a.md")).toBe("#/notes/a");
    expect(slot.container.textContent).not.toContain("Original preview");
  });

  it("keeps a thread-storage markdown file on the built-in preview", async () => {
    let requested = false;
    const slot = renderSlot(
      app.fileOpeners[0]!,
      {
        path: "notes/a.md",
        source: {
          kind: "thread-storage",
          environmentId: "env_ignored",
          projectId: null,
          threadId: "thr_store",
        },
        Original: () => <p>Original preview</p>,
      },
      {
        rpc: {
          editorOrigin: () => {
            requested = true;
            throw new Error("origin requested");
          },
        },
      },
    );
    await slot.findByText("Original preview");
    expect(requested).toBe(false);
    expect(slot.container.querySelector("iframe")).toBeNull();
  });

  it("keeps a host markdown file on the built-in preview", async () => {
    let requested = false;
    const slot = renderSlot(
      app.fileOpeners[0]!,
      {
        path: "/Users/me/notes/a.md",
        source: {
          kind: "host",
          environmentId: "env_ignored",
          projectId: null,
          threadId: null,
          experimental_hostId: "host_1",
        },
        Original: () => <p>Original preview</p>,
      },
      {
        rpc: {
          editorOrigin: () => {
            requested = true;
            throw new Error("origin requested");
          },
        },
      },
    );
    await slot.findByText("Original preview");
    expect(requested).toBe(false);
    expect(slot.container.querySelector("iframe")).toBeNull();
  });

  it("opens the nav panel on the active thread workspace origin", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        context: { threadId: "thr_nav" },
        rpc: {
          editorOrigin: (input) => {
            expect(input).toEqual({ projectId: "proj_nav" });
            return {
              origin: "http://127.0.0.1:4243",
              editorUrl: "http://127.0.0.1:4243/bb.html",
              mcpUrl: "http://127.0.0.1:4243/mcp",
              source: "local" as const,
            };
          },
        },
        sdk: {
          threads: {
            get: async () => ({ projectId: "proj_nav" }) as never,
          },
        },
      },
    );
    const editor = await slot.findByTitle("OpenKnowledge editor");
    expect(editor.getAttribute("src")).toBe("http://127.0.0.1:4243/bb.html");
  });

  it("does not load an editor when no BB project is open", async () => {
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_empty", environment: null },
      {
        rpc: {
          editorOrigin: () => {
            throw new Error("origin requested");
          },
        },
        sdk: {
          threads: {
            get: async () => {
              throw new Error("missing thread");
            },
          },
        },
      },
    );
    await slot.findByText("No project is open for this editor.");
    expect(slot.container.querySelector("iframe")).toBeNull();
  });

  it("asks for the origin again while the surface is mounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_poll", environment: { id: "env_poll" } },
      {
        context: { projectId: "proj_poll", threadId: "thr_poll" },
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
      },
    );
    await slot.findByTitle("OpenKnowledge editor");
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(EDITOR_ORIGIN_POLL_MS);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("writes a deployed origin from the iframed editor and reloads that origin", async () => {
    vi.useRealTimers();
    const root = tempDir("set-origin");
    const memory = new Map<string, unknown>();
    const kv = {
      async set(key: string, value: unknown) {
        memory.set(key, value);
      },
      async delete(key: string) {
        memory.delete(key);
      },
    };
    let originReads = 0;
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_set_origin", environment: { id: "env_set_origin" } },
      {
        context: { projectId: "proj_set", threadId: "thr_set_origin" },
        rpc: {
          editorOrigin: async () => {
            originReads += 1;
            const deployed = readDeployedOriginValue(memory.get(deployedOriginKey(root)));
            if (deployed !== undefined) return editorOriginFrom(deployed, "deployed");
            return editorOriginFrom("http://127.0.0.1:4173", "local");
          },
          setDeployedOrigin: async (input: unknown) => {
            const body = input as { projectId: string; origin: string | null };
            expect(body.projectId).toBe("proj_set");
            const origin = await writeDeployedOrigin(kv, root, body.origin);
            return { origin };
          },
        },
      },
    );
    const editor = await slot.findByTitle("OpenKnowledge editor");
    expect(editor.getAttribute("src")).toBe("http://127.0.0.1:4173/bb.html");
    const readsAfterLoad = originReads;

    const child = document.createElement("iframe");
    document.body.appendChild(child);
    const childWindow = child.contentWindow;
    if (childWindow === null) throw new Error("missing frame window");
    const replies: unknown[] = [];
    vi.spyOn(childWindow, "postMessage").mockImplementation((data: unknown) => {
      replies.push(data);
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4173",
        data: bbDeployedOriginRead(),
        source: childWindow,
      }),
    );
    expect(replies).toEqual([bbDeployedOriginCurrent("")]);

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example",
        data: bbDeployedOriginSet("https://evil.example"),
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4173",
        data: bbDeployedOriginSet("javascript:alert(1)"),
      }),
    );
    expect(memory.size).toBe(0);
    expect(editor.getAttribute("src")).toBe("http://127.0.0.1:4173/bb.html");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4173",
        data: bbDeployedOriginSet("https://notes.example/kb"),
      }),
    );
    await waitFor(() => {
      expect(slot.getByTitle("OpenKnowledge editor").getAttribute("src")).toBe(
        "https://notes.example/bb.html",
      );
    });
    expect(originReads).toBe(readsAfterLoad + 1);
    expect(memory.get(deployedOriginKey(root))).toBe("https://notes.example");
    const resolved = await resolveEditorOrigin(
      root,
      deps({
        deployedOrigin: async (workspaceRoot) =>
          readDeployedOriginValue(memory.get(deployedOriginKey(workspaceRoot))),
        readLiveLock: async () => {
          throw new Error("local server");
        },
      }),
    );
    expect(resolved.origin).toBe("https://notes.example");
    expect(resolved.source).toBe("deployed");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4173",
        data: bbDeployedOriginSet("https://later.example"),
      }),
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    expect(memory.get(deployedOriginKey(root))).toBe("https://notes.example");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://notes.example",
        data: bbDeployedOriginSet(""),
      }),
    );
    await waitFor(() => {
      expect(slot.getByTitle("OpenKnowledge editor").getAttribute("src")).toBe(
        "http://127.0.0.1:4173/bb.html",
      );
    });
    expect(memory.has(deployedOriginKey(root))).toBe(false);
  });

  function renderCommentEditor(threadId: string | null, text: string) {
    return renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_comment", environment: { id: "env_comment" } },
      {
        context: { projectId: "proj_comment", threadId },
        composer: { text },
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
            get: async () => ({ path: "/tmp/workspace-comment" }) as never,
          },
        },
      },
    );
  }

  function commentFrame(): Window {
    const child = document.createElement("iframe");
    document.body.appendChild(child);
    const childWindow = child.contentWindow;
    if (childWindow === null) throw new Error("missing frame window");
    return childWindow;
  }

  it("appends a comment path and quote at the end of the open thread composer", async () => {
    const slot = renderCommentEditor("thr_comment", "Keep this.");
    await slot.findByTitle("OpenKnowledge editor");
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4173",
        data: bbCommentChatAdd("recipes/stir-fry", "the tofu"),
        source: commentFrame(),
      }),
    );
    expect(slot.composer.text).toBe("Keep this. @Docs: the tofu ");
    expect(slot.composer.draft.mentions).toMatchObject([
      {
        kind: "plugin",
        provider: "document-comment",
        label: "Docs: the tofu",
      },
    ]);
    const mention = slot.composer.draft.mentions[0];
    if (!mention || mention.kind !== "plugin") throw new Error("missing Docs chip");
    expect(commentChatContextFromId(mention.id)).toBe(
      [
        "The user attached this passage from a Docs document to their message:",
        "Document: recipes/stir-fry",
        "> the tofu",
        "Their comment: ",
      ].join("\n\n"),
    );
    expect(slot.composer.focusCount).toBe(1);
  });

  it("ignores a comment message from an origin other than the iframed project", async () => {
    const slot = renderCommentEditor("thr_comment", "Keep this.");
    await slot.findByTitle("OpenKnowledge editor");
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example",
        data: bbCommentChatAdd("recipes/stir-fry", "the tofu"),
        source: commentFrame(),
      }),
    );
    expect(slot.composer.text).toBe("Keep this.");
    expect(slot.composer.focusCount).toBe(0);
  });

  it("reports that no thread composer is mounted and leaves the composer unchanged", async () => {
    const slot = renderCommentEditor(null, "Keep this.");
    await slot.findByTitle("OpenKnowledge editor");
    const childWindow = commentFrame();
    const replies: unknown[] = [];
    vi.spyOn(childWindow, "postMessage").mockImplementation((data: unknown) => {
      replies.push(data);
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4173",
        data: bbCommentChatAdd("recipes/stir-fry", "the tofu"),
        source: childWindow,
      }),
    );
    expect(slot.composer.text).toBe("Keep this.");
    expect(slot.composer.focusCount).toBe(0);
    expect(replies).toEqual([bbCommentChatComposer(false)]);
  });

  it("appends the quote when the thread is open and the composer box is not the active surface", async () => {
    const slot = renderSlot(
      { component: ThreadEditor },
      { threadId: "thr_comment", environment: { id: "env_comment" } },
      {
        context: { projectId: "proj_comment", threadId: "thr_comment" },
        composer: {
          text: "Keep this.",
          scope: { kind: "new-thread", projectId: "proj_comment" },
          layout: "compact",
        },
        rpc: {
          editorOrigin: () => ({
            origin: "http://127.0.0.1:4173",
            editorUrl: "http://127.0.0.1:4173/bb.html",
            mcpUrl: "http://127.0.0.1:4173/mcp",
            source: "local" as const,
          }),
        },
      },
    );
    await slot.findByTitle("OpenKnowledge editor");
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4173",
        data: bbCommentChatAdd("recipes/stir-fry", "the tofu"),
        source: commentFrame(),
      }),
    );
    expect(slot.composer.text).toBe("Keep this. @Docs: the tofu ");
    expect(slot.composer.draft.mentions).toMatchObject([
      { kind: "plugin", provider: "document-comment", label: "Docs: the tofu" },
    ]);
  });
});

interface DeployedOriginHandler {
  setDeployedOrigin(input: {
    projectId: string;
    origin: string | null;
  }): Promise<{ origin: string | null }>;
}

describe("workspace project server", () => {
  it("starts the local server with the switch that skips OpenKnowledge auto-sync", () => {
    expect(startCliArgs).toEqual(["start", "--no-open-browser", "--no-auto-sync"]);
  });

  it("uses the project's checkout, shared by every thread", () => {
    const checkout = tempDir("project-checkout");
    const dataDir = "/tmp/bb-data";
    expect(
      corpusDirectory({
        projectId: "proj_notes",
        sources: [
          { path: "/tmp/thread-workspace", isDefault: false },
          { path: checkout, isDefault: true },
        ],
        dataDir,
      }),
    ).toBe(canonicalWorkspaceRoot(checkout));
    expect(
      corpusDirectory({ projectId: "proj_personal", sources: [], dataDir }),
    ).toBe(canonicalWorkspaceRoot(join(dataDir, GENERAL_CORPUS_DIRECTORY)));
    expect(GENERAL_CORPUS_DIRECTORY).toBe("General");
    expect(() =>
      corpusDirectory({
        projectId: "../proj_notes",
        sources: [{ path: checkout, isDefault: true }],
        dataDir,
      }),
    ).toThrow(/single path segment/u);
  });

  it("stores a deployed origin from the settings RPC on the key U1 reads", async () => {
    const root = tempDir("rpc-origin");
    const memory = new Map<string, unknown>();
    const registered: { current: DeployedOriginHandler | null } = { current: null };
    await plugin({
      server: { experimental_dataDir: "/tmp/bb-data" },
      onDispose() {},
      sdk: {
        projects: {
          get: async () => ({ sources: [{ path: root, isDefault: true }] }),
        },
      },
      storage: {
        kv: {
          get: async (key: string) => memory.get(key),
          set: async (key: string, value: unknown) => {
            memory.set(key, value);
          },
          delete: async (key: string) => {
            memory.delete(key);
          },
          list: async () => [...memory.keys()],
        },
      },
      ui: { registerMentionProvider() {} },
      rpc: {
        register(_contract: unknown, impl: DeployedOriginHandler) {
          registered.current = impl;
        },
      },
    } as unknown as Parameters<typeof plugin>[0]);
    const handlers = registered.current;
    if (handlers === null) throw new Error("setDeployedOrigin was not registered");
    await expect(
      handlers.setDeployedOrigin({ projectId: "proj_rpc", origin: "javascript:alert(1)" }),
    ).rejects.toThrow(/http\(s\)/u);
    expect(memory.size).toBe(0);
    await expect(
      handlers.setDeployedOrigin({
        projectId: "proj_rpc",
        origin: "https://user:secret@notes.example/kb",
      }),
    ).rejects.toThrow(/http\(s\)/u);
    const stored = await handlers.setDeployedOrigin({
      projectId: "proj_rpc",
      origin: "https://notes.example/kb",
    });
    expect(stored.origin).toBe("https://notes.example");
    expect(memory.get(deployedOriginKey(root))).toBe("https://notes.example");
    const resolved = await resolveEditorOrigin(
      root,
      deps({
        deployedOrigin: async (workspaceRoot) =>
          readDeployedOriginValue(memory.get(deployedOriginKey(workspaceRoot))),
      }),
    );
    expect(resolved).toMatchObject({ origin: "https://notes.example", source: "deployed" });
    expect(await handlers.setDeployedOrigin({ projectId: "proj_rpc", origin: "" })).toEqual({
      origin: null,
    });
    expect(memory.has(deployedOriginKey(root))).toBe(false);
    expect(await handlers.setDeployedOrigin({ projectId: "proj_rpc", origin: null })).toEqual({
      origin: null,
    });
  });

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
