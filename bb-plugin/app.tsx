import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useBbContext,
  useComposer,
  useComposers,
  useRpc,
  useSdk,
  type PluginFileOpenerProps,
  type PluginNavPanelProps,
  type PluginSettingsSectionProps,
} from "@get-bb/plugin-sdk/app";
import {
  bbPluginSettingsPath,
  bbSettingsFrameUrl,
  readBbSettingsMessage,
} from "./bb-settings";
import {
  bbCommentChatComposer,
  commentChatInsertParts,
  readBbCommentChatMessage,
} from "./comment-chat";
import {
  bbDeployedOriginCurrent,
  deployedOriginSetting,
  readBbDeployedOriginMessage,
} from "./deployed-origin";
import type { rpcContract } from "./server";

export const EDITOR_ORIGIN_POLL_MS = 15_000;

type ComposerHandle = ReturnType<typeof useComposer>;

function isThreadDraft(
  scope: ComposerHandle["scope"],
): scope is Extract<ComposerHandle["scope"], { kind: "thread" | "queued-message" }> {
  return scope.kind === "thread" || scope.kind === "queued-message";
}

/** The thread draft, including when its box is not the active surface. */
export function commentComposer(
  current: ComposerHandle,
  listed: readonly ComposerHandle[],
  threadId: string | null,
): ComposerHandle | null {
  const sameThread = (composer: ComposerHandle) =>
    isThreadDraft(composer.scope) && (threadId === null || composer.scope.threadId === threadId);
  const onScreen = listed.find(sameThread);
  if (onScreen) return onScreen;
  if (sameThread(current)) return current;
  // This editor is open inside a thread. That handle still writes the thread
  // draft after the composer box leaves the screen.
  if (threadId !== null) return current;
  return null;
}

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

function postToMessageSource(event: MessageEvent, data: unknown): void {
  const source = event.source;
  if (source instanceof Window) {
    source.postMessage(data, event.origin);
    return;
  }
  if (source !== null && typeof source.postMessage === "function" && !("start" in source)) {
    (source as unknown as Window).postMessage(data, event.origin);
  }
}

function postComposerStatus(
  origin: string | null,
  target: Window | null | undefined,
  mounted: boolean,
): void {
  if (origin === null || target == null) return;
  target.postMessage(bbCommentChatComposer(mounted), origin);
}

function EditorSettings(_props: PluginSettingsSectionProps) {
  const context = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (context.projectId === null) return;
    let active = true;
    void rpc.call("editorOrigin", { projectId: context.projectId }).then(
      (next) => {
        if (active) setUrl(bbSettingsFrameUrl(next.editorUrl));
      },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Settings entry failed");
      },
    );
    return () => {
      active = false;
    };
  }, [context.projectId, rpc]);

  if (context.projectId === null) return <p>No project is open for these settings.</p>;
  if (error) return <p>{error}</p>;
  if (url === null) return <p>Loading settings.</p>;
  return (
    <iframe
      title="OpenKnowledge settings"
      src={url}
      style={{ width: "100%", height: "70vh", border: 0 }}
    />
  );
}

function EditorSurface({
  projectId,
  documentPath = null,
}: {
  projectId: string | null | undefined;
  documentPath?: string | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const pluginId = experimental_usePluginId();
  const composer = useComposer();
  const composers = useComposers();
  const threadId = useBbContext().threadId;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const framedOriginRef = useRef<string | null>(null);
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const composersRef = useRef(composers);
  composersRef.current = composers;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const threadComposerMounted =
    commentComposer(composer, composers, threadId) !== null;
  const threadComposerMountedRef = useRef(threadComposerMounted);
  threadComposerMountedRef.current = threadComposerMounted;

  useEffect(() => {
    postComposerStatus(
      framedOriginRef.current,
      frameRef.current?.contentWindow,
      threadComposerMounted,
    );
  }, [threadComposerMounted]);

  useEffect(() => {
    framedOriginRef.current = null;
    if (projectId === undefined || projectId === null) return;
    const currentProjectId = projectId;
    let active = true;
    let request = 0;
    let framedOrigin: string | null = null;
    let deployedOrigin = "";
    const load = () => {
      const id = ++request;
      void rpc.call("editorOrigin", { projectId: currentProjectId }).then(
        (next) => {
          if (!active || id !== request) return;
          framedOrigin = next.origin;
          framedOriginRef.current = next.origin;
          deployedOrigin = next.source === "deployed" ? next.origin : "";
          setError(null);
          setUrl(editorFrameUrl(next.editorUrl, documentPath));
          postComposerStatus(
            next.origin,
            frameRef.current?.contentWindow,
            threadComposerMountedRef.current,
          );
        },
        (reason: unknown) => {
          if (!active || id !== request) return;
          setError(reason instanceof Error ? reason.message : "Editor entry failed");
        },
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (framedOrigin === null || event.origin !== framedOrigin) return;
      const message = readBbDeployedOriginMessage(event.data);
      if (message) {
        if (message.intent === "read") {
          postToMessageSource(event, bbDeployedOriginCurrent(deployedOrigin));
          return;
        }
        if (message.intent !== "set") return;
        void applySet(message.origin);
        return;
      }
      if (readBbSettingsMessage(event.data)) {
        window.location.assign(bbPluginSettingsPath(pluginId));
        return;
      }
      const comment = readBbCommentChatMessage(event.data);
      if (!comment) return;
      if (comment.intent === "read") {
        postToMessageSource(event, bbCommentChatComposer(threadComposerMountedRef.current));
        return;
      }
      if (comment.intent !== "add") return;
      const target = commentComposer(
        composerRef.current,
        composersRef.current,
        threadIdRef.current,
      );
      if (target === null) {
        postToMessageSource(event, bbCommentChatComposer(false));
        return;
      }
      try {
        target.insert(
          commentChatInsertParts(target.text, comment.path, comment.quote, comment.body),
          { at: "end" },
        );
      } catch {
        postToMessageSource(event, bbCommentChatComposer(false));
        return;
      }
      try {
        target.focus();
      } catch {
        // The draft already has the quote. Focusing requires the box on screen.
      }
      postToMessageSource(event, bbCommentChatComposer(true));
    };
    async function applySet(raw: string): Promise<void> {
      let next: string | null;
      try {
        next = deployedOriginSetting(raw);
      } catch {
        return;
      }
      try {
        await rpc.call("setDeployedOrigin", { projectId: currentProjectId, origin: next });
      } catch {
        return;
      }
      if (active) load();
    }
    window.addEventListener("message", onMessage);
    load();
    const timer = setInterval(load, EDITOR_ORIGIN_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [documentPath, pluginId, projectId, rpc]);

  if (projectId === undefined) return <p>Loading the editor.</p>;
  if (projectId === null) return <p>No project is open for this editor.</p>;
  if (url) {
    return (
      <div
        style={{
          display: "flex",
          flex: "1 1 auto",
          width: "100%",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <iframe
          ref={frameRef}
          title="OpenKnowledge editor"
          src={url}
          onLoad={() => {
            postComposerStatus(
              framedOriginRef.current,
              frameRef.current?.contentWindow,
              threadComposerMountedRef.current,
            );
          }}
          style={{ flex: "1 1 auto", width: "100%", height: "100%", border: 0 }}
        />
      </div>
    );
  }
  if (error) return <p>{error}</p>;
  return <p>Loading the editor.</p>;
}

function useResolvedProjectId(threadId: string | null): string | null | undefined {
  const context = useBbContext();
  const sdk = useSdk();
  const [projectId, setProjectId] = useState<string | null | undefined>(
    context.projectId === null && threadId !== null ? undefined : context.projectId,
  );

  useEffect(() => {
    if (context.projectId !== null) {
      setProjectId(context.projectId);
      return;
    }
    if (threadId === null) {
      setProjectId(null);
      return;
    }
    let active = true;
    setProjectId(undefined);
    void Promise.resolve()
      .then(() => sdk.threads.get({ threadId }))
      .then(
        (thread) => {
          if (active) setProjectId(thread.projectId);
        },
        () => {
          if (active) setProjectId(null);
        },
      );
    return () => {
      active = false;
    };
  }, [context.projectId, sdk, threadId]);

  return projectId;
}

export function ThreadEditor(props: { threadId: string; environment: { id: string } | null }) {
  const projectId = useResolvedProjectId(props.threadId);
  return <EditorSurface projectId={projectId} />;
}

function NavEditor(_props: PluginNavPanelProps) {
  const { threadId } = useBbContext();
  const projectId = useResolvedProjectId(threadId);
  return <EditorSurface projectId={projectId} />;
}

function MarkdownFileOpener({ path, source, Original }: PluginFileOpenerProps) {
  if (source.kind !== "workspace") return <Original />;
  return <EditorSurface projectId={source.projectId} documentPath={path} />;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "editor",
    title: "Editor",
    description: "OpenKnowledge settings for this project. GitHub sync stays in BB.",
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
