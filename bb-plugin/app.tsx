import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useSdk,
  type PluginNavPanelProps,
  type PluginSettingsSectionProps,
} from "@get-bb/plugin-sdk/app";
import { markBbEditorHost } from "../packages/app/src/lib/bb-editor-host";
import type { rpcContract } from "./server";

markBbEditorHost();

const EDITOR_SOURCE = "../packages/app/src";

export const EDITOR_ORIGIN_POLL_MS = 15_000;

function EditorSettings(_props: PluginSettingsSectionProps) {
  return (
    <p>
      Editor settings from {EDITOR_SOURCE} appear here. The terminal is omitted.
      GitHub sync is a BB setting, not an OpenKnowledge setting.
    </p>
  );
}

function EditorSurface({ workspaceRoot }: { workspaceRoot: string | null | undefined }) {
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
          setUrl(next.editorUrl);
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
  }, [rpc, workspaceRoot]);

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

export function ThreadEditor(props: { threadId: string; environment: { id: string } | null }) {
  const sdk = useSdk();
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null | undefined>(
    props.environment === null ? null : undefined,
  );

  useEffect(() => {
    if (props.environment === null) {
      setWorkspaceRoot(null);
      return;
    }
    let active = true;
    setWorkspaceRoot(undefined);
    void sdk.environments.get({ environmentId: props.environment.id }).then(
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
  }, [sdk, props.environment]);

  return <EditorSurface workspaceRoot={workspaceRoot} />;
}

function NavEditor(_props: PluginNavPanelProps) {
  return <EditorSurface workspaceRoot={null} />;
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
});
