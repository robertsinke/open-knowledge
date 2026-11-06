export const BB_COMMENT_CHAT_MESSAGE = "open-knowledge:bb-chat";

export type BbCommentChatMessage =
  | { readonly type: typeof BB_COMMENT_CHAT_MESSAGE; readonly intent: "read" }
  | {
      readonly type: typeof BB_COMMENT_CHAT_MESSAGE;
      readonly intent: "composer";
      readonly mounted: boolean;
    }
  | {
      readonly type: typeof BB_COMMENT_CHAT_MESSAGE;
      readonly intent: "add";
      readonly path: string;
      readonly quote: string;
      readonly body?: string;
    };

export function bbCommentChatRead(): BbCommentChatMessage {
  return { type: BB_COMMENT_CHAT_MESSAGE, intent: "read" };
}

export function bbCommentChatComposer(mounted: boolean): BbCommentChatMessage {
  return { type: BB_COMMENT_CHAT_MESSAGE, intent: "composer", mounted };
}

export function bbCommentChatAdd(path: string, quote: string, body?: string): BbCommentChatMessage {
  const note = body?.trim() ?? "";
  return note.length > 0
    ? { type: BB_COMMENT_CHAT_MESSAGE, intent: "add", path, quote, body: note }
    : { type: BB_COMMENT_CHAT_MESSAGE, intent: "add", path, quote };
}

export const COMMENT_CHAT_MENTION_PROVIDER = "document-comment";

/** Pill text, same shape as a Docs annotation chip. */
export function commentChatPillLabel(quote: string): string {
  const flat = quote.replace(/\s+/gu, " ").trim();
  return flat.length > 36 ? `Docs: ${flat.slice(0, 29).trimEnd()}…` : `Docs: ${flat}`;
}

export function commentChatMentionId(path: string, quote: string, body?: string): string {
  return JSON.stringify({ v: 1, path, quote, body: body?.trim() ?? "" });
}

/** Agent context for one chip. The id travels with the composer draft. */
export function commentChatContextFromId(id: string): string {
  let parsed: { v?: unknown; path?: unknown; quote?: unknown; body?: unknown };
  try {
    parsed = JSON.parse(id) as { v?: unknown; path?: unknown; quote?: unknown; body?: unknown };
  } catch {
    throw new Error("This comment no longer exists");
  }
  if (
    parsed.v !== 1 ||
    typeof parsed.path !== "string" ||
    typeof parsed.quote !== "string" ||
    typeof parsed.body !== "string"
  ) {
    throw new Error("This comment no longer exists");
  }
  const quoted = parsed.quote
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return [
    "The user attached this passage from a Docs document to their message:",
    `Document: ${parsed.path}`,
    quoted,
    `Their comment: ${parsed.body}`,
  ].join("\n\n");
}

/** Chip at the end of the draft, with the same spacing Docs uses. */
export function commentChatInsertParts(
  text: string,
  path: string,
  quote: string,
  body?: string,
): Array<string | { provider: string; id: string; label: string }> {
  const lead = text.length > 0 && !/\s$/u.test(text) ? [" "] : [];
  return [
    ...lead,
    {
      provider: COMMENT_CHAT_MENTION_PROVIDER,
      id: commentChatMentionId(path, quote, body),
      label: commentChatPillLabel(quote),
    },
    " ",
  ];
}

export function bbCommentChatBlock(path: string, quote: string, body?: string): string {
  const quoted = quote
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const note = body?.trim() ?? "";
  return note.length > 0 ? `${path}\n${quoted}\n\n${note}` : `${path}\n${quoted}`;
}

export function readBbCommentChatMessage(data: unknown): BbCommentChatMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as {
    type?: unknown;
    intent?: unknown;
    mounted?: unknown;
    path?: unknown;
    quote?: unknown;
    body?: unknown;
  };
  if (record.type !== BB_COMMENT_CHAT_MESSAGE) return null;
  if (record.intent === "read") return bbCommentChatRead();
  if (record.intent === "composer" && typeof record.mounted === "boolean") {
    return bbCommentChatComposer(record.mounted);
  }
  if (
    record.intent === "add" &&
    typeof record.path === "string" &&
    typeof record.quote === "string"
  ) {
    return bbCommentChatAdd(
      record.path,
      record.quote,
      typeof record.body === "string" ? record.body : undefined,
    );
  }
  return null;
}
