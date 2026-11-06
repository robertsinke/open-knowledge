import { useEffect, useState } from "react";
import {
  definePluginApp,
  useBbContext,
  useRpc,
  useSdk,
  type PluginFileOpenerProps,
  type PluginNavPanelProps,
  type PluginSettingsSectionProps,
} from "@get-bb/plugin-sdk/app";
import { markBbEditorHost } from "../packages/app/src/lib/bb-editor-host";
import type { rpcContract } from "./server";

markBbEditorHost();

const EDITOR_SOURCE = "../packages/app/src";

export const EDITOR_ORIGIN_POLL_MS = 15_000;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function editorDocumentHash(filePath: string): string {
  const docName = filePath
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\.(md|mdx|markdown)$/i, "");
  const encoded = docName
    .split("/")
    .map((segment) => encodeURIComponent(segment.replace(LONE_SURROGATE, "\uFFFD")))
    .join("/");
  return `#/${encoded}`;
}

function editorFrameUrl(editorUrl: string, documentPath: string | null): string {
  return documentPath === null ? editorUrl : `${editorUrl}${editorDocumentHash(documentPath)}`;
}

function EditorSettings(_props: PluginSettingsSectionProps) {
  return (
    <p>
      Editor settings from {EDITOR_SOURCE} appear here. The terminal is omitted.
      GitHub sync is a BB setting, not an OpenKnowledge setting.
    </p>
  );
}

function EditorSurface({
  workspaceRoot,
  documentPath = null,
}: {
  workspaceRoot: string | null | undefined;
  documentPath?: string | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceRoot === undefined || workspaceRoot === null) return;
    let active = true;
    let pending = false;
    const load = () => {
      if (pending) return;
      pending = true;
      void rpc.call("editorOrigin", { workspaceRoot }).then(
        (next) => {
          pending = false;
          if (!active) return;
          setError(null);
          setUrl(editorFrameUrl(next.editorUrl, documentPath));
        },
        (reason: unknown) => {
          pending = false;
          if (!active) return;
          setError(reason instanceof Error ? reason.message : "Editor entry failed");
        },
      );
    };
    load();
    const timer = setInterval(load, EDITOR_ORIGIN_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [documentPath, rpc, workspaceRoot]);

  if (workspaceRoot === undefined) return <p>Loading the editor.</p>;
  if (workspaceRoot === null) return <p>No workspace is open for this editor.</p>;
  if (url) {
    return (
      <div
        style={{
          display: "flex",
          flex: "1 1 auto",
          width: "100%",
          height: "100%",
          minHeight: "100vh",
        }}
      >
        <iframe
          title="OpenKnowledge editor"
          src={url}
          style={{ flex: "1 1 auto", width: "100%", height: "100%", border: 0 }}
        />
      </div>
    );
  }
  if (error) return <p>{error}</p>;
  return <p>Loading the editor.</p>;
}

function useWorkspaceRoot(environmentId: string | null | undefined): string | null | undefined {
  const sdk = useSdk();
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null | undefined>(
    environmentId === undefined || environmentId === null ? environmentId : undefined,
  );

  useEffect(() => {
    if (environmentId === undefined || environmentId === null) {
      setWorkspaceRoot(environmentId);
      return;
    }
    let active = true;
    setWorkspaceRoot(undefined);
    void sdk.environments.get({ environmentId }).then(
      (environment) => {
        if (active) setWorkspaceRoot(environment.path);
      },
      () => {
        if (active) setWorkspaceRoot(null);
      },
    );
    return () => {
      active = false;
    };
  }, [environmentId, sdk]);

  return workspaceRoot;
}

export function ThreadEditor(props: { threadId: string; environment: { id: string } | null }) {
  const workspaceRoot = useWorkspaceRoot(props.environment === null ? null : props.environment.id);
  return <EditorSurface workspaceRoot={workspaceRoot} />;
}

function NavEditor(_props: PluginNavPanelProps) {
  const { threadId } = useBbContext();
  const sdk = useSdk();
  const [environmentId, setEnvironmentId] = useState<string | null | undefined>(
    threadId === null ? null : undefined,
  );

  useEffect(() => {
    if (threadId === null) {
      setEnvironmentId(null);
      return;
    }
    let active = true;
    setEnvironmentId(undefined);
    void sdk.threads.get({ threadId }).then(
      (thread) => {
        if (active) setEnvironmentId(thread.environmentId);
      },
      () => {
        if (active) setEnvironmentId(null);
      },
    );
    return () => {
      active = false;
    };
  }, [sdk, threadId]);

  const workspaceRoot = useWorkspaceRoot(environmentId);
  return <EditorSurface workspaceRoot={workspaceRoot} />;
}

function MarkdownFileOpener({ path, source, Original }: PluginFileOpenerProps) {
  const workspaceRoot = useWorkspaceRoot(
    source.kind === "workspace" ? source.environmentId : null,
  );
  if (source.kind !== "workspace") return <Original />;
  return <EditorSurface workspaceRoot={workspaceRoot} documentPath={path} />;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "editor",
    title: "Editor",
    description:
      "OpenKnowledge editor settings. The terminal is omitted. GitHub sync stays in BB.",
    component: EditorSettings,
  });
  app.slots.navPanel({
    id: "open-knowledge-editor",
    title: "OpenKnowledge Editor",
    icon: "Explore",
    path: "open-knowledge-editor",
    component: NavEditor,
  });
  app.slots.experimental_tab({
    id: "open-knowledge-editor",
    title: "OpenKnowledge Editor",
    icon: "Explore",
    context: { kind: "thread" },
    availability: "fixed",
    layout: "flush",
    component: ThreadEditor,
  });
  app.slots.fileOpener({
    id: "editor",
    title: "OpenKnowledge Editor",
    extensions: ["md", "mdx", "markdown"],
    component: MarkdownFileOpener,
  });
});
