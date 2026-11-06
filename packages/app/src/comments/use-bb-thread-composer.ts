import { useEffect, useState } from 'react';
import { bbCommentChatRead, readBbCommentChatMessage } from '@/lib/bb-comment-chat';
import { isBbEditorHost } from '@/lib/bb-editor-host';

export function useBbThreadComposerMounted(): boolean | null {
  const host = isBbEditorHost();
  const [mounted, setMounted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!host) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = readBbCommentChatMessage(event.data);
      if (message?.intent !== 'composer') return;
      setMounted(message.mounted);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage(bbCommentChatRead(), '*');
    return () => window.removeEventListener('message', onMessage);
  }, [host]);

  return host ? mounted : true;
}
