import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { deployedOriginSetting } from "../packages/app/src/lib/bb-deployed-origin";

const execFileAsync = promisify(execFile);

export const EDITOR_ENTRY = "bb.html";

export const initCliArgs = [
  "init",
  "--project-root",
  "cwd",
  "--no-mcp",
  "--no-skills",
  "--no-project-skills",
  "--local-only",
  "--json",
] as const;

export const startCliArgs = ["start", "--no-open-browser", "--no-auto-sync"] as const;

export const rpcContract = defineRpcContract({
  editorOrigin: {
    input: z.object({ workspaceRoot: z.string().min(1) }),
    output: z.object({
      origin: z.string(),
      editorUrl: z.string(),
      mcpUrl: z.string(),
      source: z.enum(["deployed", "local"]),
    }),
  },
  setDeployedOrigin: {
    input: z.object({
      workspaceRoot: z.string().min(1),
      origin: z.string().nullable(),
    }),
    output: z.object({
      origin: z.string().nullable(),
    }),
  },
});

export interface EditorOrigin {
  origin: string;
  editorUrl: string;
  mcpUrl: string;
  source: "deployed" | "local";
}

export type LiveServerLock =
  | { readonly state: "absent" }
  | { readonly state: "starting" }
  | { readonly state: "ready"; readonly origin: string };

export interface ProjectServerDeps {
  markerExists(workspaceRoot: string): boolean;
  readLiveLock(workspaceRoot: string): Promise<LiveServerLock>;
  deployedOrigin(workspaceRoot: string): Promise<string | undefined>;
  runInit(workspaceRoot: string): Promise<void>;
  runStart(workspaceRoot: string): Promise<void>;
}

export function pluginRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginDir = basename(here) === "dist" ? dirname(here) : here;
  return dirname(pluginDir);
}

export function canonicalWorkspaceRoot(workspaceRoot: string): string {
  const absolute = resolve(workspaceRoot);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function projectMarkerPath(workspaceRoot: string): string {
  return join(canonicalWorkspaceRoot(workspaceRoot), ".ok", "config.yml");
}

export function deployedOriginKey(workspaceRoot: string): string {
  return `deployed-origin:${canonicalWorkspaceRoot(workspaceRoot)}`;
}

export function mcpUrlKey(workspaceRoot: string): string {
  return `mcp-url:${canonicalWorkspaceRoot(workspaceRoot)}`;
}

export function editorOriginFrom(origin: string, source: EditorOrigin["source"]): EditorOrigin {
  const base = httpOrigin(origin);
  return {
    origin: base,
    editorUrl: `${base}/${EDITOR_ENTRY}`,
    mcpUrl: `${base}/mcp`,
    source,
  };
}

function httpOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Editor origin must be an http(s) URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Editor origin must be an http(s) URL: ${value}`);
  }
  return url.origin;
}

function tsxPath(): string {
  return join(pluginRepoRoot(), "node_modules/tsx/dist/esm/index.mjs");
}

function cliEntry(): string {
  return join(pluginRepoRoot(), "packages/cli/src/cli.ts");
}

function cliDir(): string {
  return join(pluginRepoRoot(), "packages/cli");
}

function cliNodeArgs(command: readonly string[]): string[] {
  return ["--conditions=development", "--import", tsxPath(), cliEntry(), ...command];
}

function commandError(err: unknown): Error {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? "").trim();
    const message = err instanceof Error ? err.message : String(err);
    return new Error(stderr.length > 0 ? `${message}\n${stderr}` : message);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function runWorkspaceInit(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, cliNodeArgs(initCliArgs), {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    throw commandError(err);
  }
}

const LOCK_WORKER_SOURCE = `
import { createInterface } from "node:readline";
import { readLiveServerLock } from "./src/commands/start.ts";
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (!request || typeof request.id !== "number" || typeof request.root !== "string") return;
  const body = readLiveServerLock(request.root);
  process.stdout.write("ok-lock " + JSON.stringify({ id: request.id, body }) + "\\n");
});
`;

interface LockWaiter {
  resolve(body: LiveServerLock): void;
  reject(err: Error): void;
}

let lockWorker: ChildProcessWithoutNullStreams | null = null;
let lockBuffer = "";
let lockSeq = 0;
const lockWaiters = new Map<number, LockWaiter>();

function failLockWaiters(err: Error): void {
  for (const waiter of lockWaiters.values()) waiter.reject(err);
  lockWaiters.clear();
}

function ensureLockWorker(): ChildProcessWithoutNullStreams {
  if (lockWorker && lockWorker.exitCode === null && !lockWorker.killed) return lockWorker;
  const child = spawn(
    process.execPath,
    ["--conditions=development", "--import", tsxPath(), "--input-type=module", "-e", LOCK_WORKER_SOURCE],
    { cwd: cliDir(), stdio: ["pipe", "pipe", "pipe"] },
  );
  lockBuffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    lockBuffer += chunk;
    let newline = lockBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = lockBuffer.slice(0, newline).trim();
      lockBuffer = lockBuffer.slice(newline + 1);
      newline = lockBuffer.indexOf("\n");
      if (!line.startsWith("ok-lock ")) continue;
      let parsed: { id?: unknown; body?: LiveServerLock };
      try {
        parsed = JSON.parse(line.slice("ok-lock ".length)) as { id?: unknown; body?: LiveServerLock };
      } catch {
        continue;
      }
      if (typeof parsed.id !== "number" || parsed.body === undefined) continue;
      const waiter = lockWaiters.get(parsed.id);
      if (!waiter) continue;
      lockWaiters.delete(parsed.id);
      waiter.resolve(parsed.body);
    }
  });
  child.on("exit", () => {
    if (lockWorker === child) lockWorker = null;
    failLockWaiters(new Error("OpenKnowledge lock reader stopped"));
  });
  lockWorker = child;
  return child;
}

export function stopWorkspaceServerLockReader(): void {
  const child = lockWorker;
  lockWorker = null;
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

export function readWorkspaceServerLock(workspaceRoot: string): Promise<LiveServerLock> {
  const root = canonicalWorkspaceRoot(workspaceRoot);
  const child = ensureLockWorker();
  const id = ++lockSeq;
  return new Promise((resolveLock, rejectLock) => {
    const timer = setTimeout(() => {
      lockWaiters.delete(id);
      rejectLock(new Error(`Timed out reading the OpenKnowledge server lock for ${root}`));
    }, 30_000);
    lockWaiters.set(id, {
      resolve(body) {
        clearTimeout(timer);
        resolveLock(body);
      },
      reject(err) {
        clearTimeout(timer);
        rejectLock(err);
      },
    });
    child.stdin.write(`${JSON.stringify({ id, root })}\n`);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function runWorkspaceStart(workspaceRoot: string): Promise<void> {
  const stderrDir = mkdtempSync(join(tmpdir(), "ok-bb-start-"));
  const stderrPath = join(stderrDir, "stderr.txt");
  const stderrFd = openSync(stderrPath, "w");
  const child = spawn(process.execPath, cliNodeArgs(startCliArgs), {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", stderrFd],
    env: process.env,
  });
  closeSync(stderrFd);
  child.unref();
  let exitCode: number | null = null;
  child.once("exit", (code) => {
    exitCode = code ?? 1;
  });
  const deadline = Date.now() + 90_000;
  const stderrText = (): string => readFileSync(stderrPath, "utf8").trim();
  try {
    while (Date.now() < deadline) {
      const lock = await readWorkspaceServerLock(workspaceRoot);
      if (lock.state === "ready") return;
      if (exitCode !== null && exitCode !== 0) {
        throw new Error(`ok start failed (${exitCode}): ${stderrText()}`);
      }
      if (exitCode === 0 && lock.state === "absent") {
        throw new Error(`ok start exited before a live server was recorded: ${stderrText()}`);
      }
      await delay(250);
    }
    throw new Error(`Timed out waiting for the OpenKnowledge server at ${workspaceRoot}`);
  } catch (err) {
    if (exitCode === null) child.kill("SIGTERM");
    throw err;
  } finally {
    rmSync(stderrDir, { recursive: true, force: true });
  }
}

async function runInitIsolated(workspaceRoot: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "ok-bb-init-home-"));
  try {
    await runWorkspaceInit(workspaceRoot, { ...process.env, HOME: home, USERPROFILE: home });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function createWorkspaceServerDeps(input: {
  deployedOrigin(workspaceRoot: string): Promise<string | undefined>;
}): ProjectServerDeps {
  return {
    markerExists(workspaceRoot) {
      return existsSync(projectMarkerPath(workspaceRoot));
    },
    readLiveLock: readWorkspaceServerLock,
    deployedOrigin: input.deployedOrigin,
    runInit: runInitIsolated,
    runStart: runWorkspaceStart,
  };
}

async function waitForReadyOrAbsent(
  workspaceRoot: string,
  deps: ProjectServerDeps,
): Promise<string | null> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const lock = await deps.readLiveLock(workspaceRoot);
    if (lock.state === "ready") return lock.origin;
    if (lock.state === "absent") return null;
    await delay(250);
  }
  throw new Error(`Timed out waiting for the OpenKnowledge server at ${workspaceRoot}`);
}

async function resolveLocalOrigin(workspaceRoot: string, deps: ProjectServerDeps): Promise<string> {
  const current = await deps.readLiveLock(workspaceRoot);
  if (current.state === "ready") return current.origin;
  if (current.state === "starting") {
    const waited = await waitForReadyOrAbsent(workspaceRoot, deps);
    if (waited !== null) return waited;
  }
  await deps.runStart(workspaceRoot);
  const started = await deps.readLiveLock(workspaceRoot);
  if (started.state !== "ready") {
    throw new Error(`OpenKnowledge server did not record a live origin for ${workspaceRoot}`);
  }
  return started.origin;
}

const originInflight = new Map<string, Promise<EditorOrigin>>();

async function resolveEditorOriginOnce(
  workspaceRoot: string,
  deps: ProjectServerDeps,
): Promise<EditorOrigin> {
  if (!deps.markerExists(workspaceRoot)) {
    await deps.runInit(workspaceRoot);
    if (!deps.markerExists(workspaceRoot)) {
      throw new Error(`OpenKnowledge project marker is missing at ${workspaceRoot}`);
    }
  }
  const deployed = await deps.deployedOrigin(workspaceRoot);
  if (deployed !== undefined) return editorOriginFrom(deployed, "deployed");
  return editorOriginFrom(await resolveLocalOrigin(workspaceRoot, deps), "local");
}

export function resolveEditorOrigin(
  workspaceRoot: string,
  deps: ProjectServerDeps,
): Promise<EditorOrigin> {
  const root = canonicalWorkspaceRoot(workspaceRoot);
  const current = originInflight.get(root);
  if (current) return current;
  const pending = resolveEditorOriginOnce(root, deps).finally(() => {
    if (originInflight.get(root) === pending) originInflight.delete(root);
  });
  originInflight.set(root, pending);
  return pending;
}

export function readDeployedOriginValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function writeDeployedOrigin(
  kv: {
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  },
  workspaceRoot: string,
  origin: string | null,
): Promise<string | null> {
  const key = deployedOriginKey(workspaceRoot);
  const next = deployedOriginSetting(origin ?? "");
  if (next === null) {
    await kv.delete(key);
    return null;
  }
  await kv.set(key, next);
  return next;
}

export default async function plugin(bb: BbPluginApi) {
  bb.onDispose(() => {
    stopWorkspaceServerLockReader();
  });
  const deps = createWorkspaceServerDeps({
    async deployedOrigin(workspaceRoot) {
      return readDeployedOriginValue(await bb.storage.kv.get(deployedOriginKey(workspaceRoot)));
    },
  });
  bb.rpc.register(rpcContract, {
    async editorOrigin(input) {
      const root = canonicalWorkspaceRoot(input.workspaceRoot);
      const result = await resolveEditorOrigin(root, deps);
      await bb.storage.kv.set(mcpUrlKey(root), result.mcpUrl);
      return result;
    },
    async setDeployedOrigin(input) {
      const origin = await writeDeployedOrigin(bb.storage.kv, input.workspaceRoot, input.origin);
      return { origin };
    },
  });
}
