import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  bbCommentChatAdd,
  bbCommentChatComposer,
  bbCommentChatRead,
  readBbCommentChatMessage,
} from '@/lib/bb-comment-chat';
import { clearBbEditorHost, markBbEditorHost } from '@/lib/bb-editor-host';
import type { CommentThread } from './types';

const sent: (readonly string[])[] = [];
const threads = new Map<string, CommentThread>();
const dispatchComments = vi.fn();
let openSession: { kind: 'thread'; agentId: string; iconUrl: string | null } | null = null;

function logEntry(id: string, docName: string, quote: string): CommentThread {
  return {
    id,
    docName,
    target: { kind: 'body' },
    anchor: { quote, prefix: '', suffix: '', start: 0, end: quote.length },
    status: 'open',
    body: 'press it?',
    createdAt: 1,
    updatedAt: 1,
    queued: true,
  };
}

vi.doMock('@/components/acp/RegisteredAgentIcon', () => ({
  RegisteredAgentIcon: () => null,
}));
vi.doMock('@/components/handoff/AgentSplitButton', () => ({
  AgentSplitButton: ({
    primary,
    onPrimary,
    primaryDisabled,
    testIds,
  }: {
    primary: ReactNode;
    onPrimary: () => void;
    primaryDisabled: boolean;
    testIds: { primary: string };
  }) => (
    <Button
      type="button"
      data-testid={testIds.primary}
      disabled={primaryDisabled}
      onClick={onPrimary}
    >
      {primary}
    </Button>
  ),
}));
vi.doMock('@/components/reusable-session-store', () => ({ useReusableSession: () => openSession }));
vi.doMock('@/lib/keyboard-shortcuts', () => ({
  formatShortcut: () => '⇧⌘ Enter',
  formatShortcutLabel: () => 'Shift Command Enter',
}));
vi.doMock('./use-comment-agent-picker', () => ({
  useCommentAgentPicker: () => ({ threadAgent: null, rows: {} }),
}));
vi.doMock('./use-comment-delivery', () => ({ useCommentDispatch: () => () => {} }));
vi.doMock('./use-send-queue', () => ({
  useSendQueue: () => (ids: readonly string[]) => sent.push(ids),
}));
vi.doMock('./store', () => ({
  dispatchComments: (...args: unknown[]) => dispatchComments(...args),
  getThreadById: (id: string) => threads.get(id) ?? null,
}));

afterEach(() => {
  cleanup();
  sent.length = 0;
  threads.clear();
  dispatchComments.mockClear();
  openSession = null;
  clearBbEditorHost();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function parentReply(mounted: boolean): void {
  vi.spyOn(window.parent, 'postMessage').mockImplementation((data: unknown) => {
    if (readBbCommentChatMessage(data)?.intent !== 'read') return;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: bbCommentChatComposer(mounted),
        source: window.parent,
      }),
    );
  });
}

test('footer names an open chat in the button and shortcut tooltip', async () => {
  vi.stubGlobal('okDesktop', { config: { ptyAvailable: true } });
  openSession = { kind: 'thread', agentId: 'agent', iconUrl: null };
  const { CommentSendFooter } = await import('./CommentSendFooter');
  render(
    <CommentSendFooter
      threadIds={['a']}
      totalCount={1}
      selection={<span>Bulk selection</span>}
      testIdPrefix="comments"
    />,
  );

  expect(screen.getByRole('button', { name: 'Send to chat' })).toBeTruthy();
  expect(screen.getByText('⇧⌘ ↵').getAttribute('title')).toBe('Send to chat (Shift Command Enter)');
});

test('the web page does not offer send to chat', async () => {
  vi.stubGlobal('okDesktop', undefined);
  const { CommentSendFooter } = await import('./CommentSendFooter');
  render(
    <CommentSendFooter
      threadIds={['a', 'b']}
      totalCount={4}
      selection={<span>Bulk selection</span>}
      testIdPrefix="comments"
    />,
  );

  expect(screen.getByText('Bulk selection')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start a new chat' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send to chat' })).toBeNull();
});

test('footer shows the selection and Enter glyph, and sends the selected threads', async () => {
  vi.stubGlobal('okDesktop', { config: { ptyAvailable: true } });
  const { CommentSendFooter } = await import('./CommentSendFooter');
  render(
    <CommentSendFooter
      threadIds={['a', 'b']}
      totalCount={4}
      selection={<span>Bulk selection</span>}
      testIdPrefix="comments"
    />,
  );

  expect(screen.getByText('Bulk selection')).toBeTruthy();
  expect(screen.getByText('2 of 4')).toBeTruthy();
  expect(screen.getByText('⇧⌘ ↵')).toBeTruthy();
  expect(screen.getByText('⇧⌘ ↵').getAttribute('title')).toBe(
    'Start a new chat (Shift Command Enter)',
  );
  expect(screen.getByRole('button', { name: 'Start a new chat' })).toBeTruthy();
  fireEvent.click(screen.getByTestId('comments-send'));
  expect(sent).toEqual([['a', 'b']]);
});

test('Add to chat appends the path and quote and leaves the log entry', async () => {
  markBbEditorHost();
  const entry = logEntry('a', 'recipes/stir-fry', 'the tofu');
  threads.set(entry.id, entry);
  const posted: unknown[] = [];
  vi.spyOn(window.parent, 'postMessage').mockImplementation((data: unknown) => {
    posted.push(data);
    if (readBbCommentChatMessage(data)?.intent !== 'read') return;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: bbCommentChatComposer(true),
        source: window.parent,
      }),
    );
  });
  const { CommentSendFooter } = await import('./CommentSendFooter');
  render(
    <CommentSendFooter
      threadIds={['a']}
      totalCount={1}
      selection={<span>Bulk selection</span>}
      testIdPrefix="comments"
    />,
  );

  const button = screen.getByRole('button', { name: 'Add to chat' });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  expect(posted).toContainEqual(bbCommentChatRead());
  expect(posted).toContainEqual(bbCommentChatAdd('recipes/stir-fry', 'the tofu', 'press it?'));
  expect(sent).toEqual([]);
  expect(dispatchComments).not.toHaveBeenCalled();
  expect(threads.get('a')).toBe(entry);
});

test('Add to chat stays available when the thread composer is not the active surface', async () => {
  markBbEditorHost();
  const entry = logEntry('a', 'recipes/stir-fry', 'the tofu');
  threads.set(entry.id, entry);
  parentReply(false);
  const { CommentSendFooter } = await import('./CommentSendFooter');
  render(
    <CommentSendFooter
      threadIds={['a']}
      totalCount={1}
      selection={<span>Bulk selection</span>}
      testIdPrefix="comments"
    />,
  );

  const button = screen.getByRole('button', { name: 'Add to chat' });
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('The BB thread composer is not open.'),
  );
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  expect(sent).toEqual([]);
  expect(dispatchComments).not.toHaveBeenCalled();
  expect(threads.get('a')).toBe(entry);
});
