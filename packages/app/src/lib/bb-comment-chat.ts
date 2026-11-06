export const BB_COMMENT_CHAT_MESSAGE = 'open-knowledge:bb-chat';

export type BbCommentChatMessage =
  | { readonly type: typeof BB_COMMENT_CHAT_MESSAGE; readonly intent: 'read' }
  | {
      readonly type: typeof BB_COMMENT_CHAT_MESSAGE;
      readonly intent: 'composer';
      readonly mounted: boolean;
    }
  | {
      readonly type: typeof BB_COMMENT_CHAT_MESSAGE;
      readonly intent: 'add';
      readonly path: string;
      readonly quote: string;
    };

export function bbCommentChatRead(): BbCommentChatMessage {
  return { type: BB_COMMENT_CHAT_MESSAGE, intent: 'read' };
}

export function bbCommentChatComposer(mounted: boolean): BbCommentChatMessage {
  return { type: BB_COMMENT_CHAT_MESSAGE, intent: 'composer', mounted };
}

export function bbCommentChatAdd(path: string, quote: string): BbCommentChatMessage {
  return { type: BB_COMMENT_CHAT_MESSAGE, intent: 'add', path, quote };
}

export function bbCommentChatBlock(path: string, quote: string): string {
  const quoted = quote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${path}\n${quoted}`;
}

export function readBbCommentChatMessage(data: unknown): BbCommentChatMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as {
    type?: unknown;
    intent?: unknown;
    mounted?: unknown;
    path?: unknown;
    quote?: unknown;
  };
  if (record.type !== BB_COMMENT_CHAT_MESSAGE) return null;
  if (record.intent === 'read') return bbCommentChatRead();
  if (record.intent === 'composer' && typeof record.mounted === 'boolean') {
    return bbCommentChatComposer(record.mounted);
  }
  if (
    record.intent === 'add' &&
    typeof record.path === 'string' &&
    typeof record.quote === 'string'
  ) {
    return bbCommentChatAdd(record.path, record.quote);
  }
  return null;
}
