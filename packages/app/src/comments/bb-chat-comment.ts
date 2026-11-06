import { bbCommentChatAdd } from '@/lib/bb-comment-chat';
import { isBbEditorHost } from '@/lib/bb-editor-host';
import { getThreadById } from './store';

export function addCommentsToBbChat(threadIds: readonly string[]): void {
  if (!isBbEditorHost()) return;
  for (const threadId of threadIds) {
    const thread = getThreadById(threadId);
    if (thread === null) continue;
    window.parent.postMessage(
      bbCommentChatAdd(thread.docName, thread.anchor?.quote ?? '', thread.body),
      '*',
    );
  }
}
