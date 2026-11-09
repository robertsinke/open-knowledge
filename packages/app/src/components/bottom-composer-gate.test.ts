import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type BottomComposerGateInputs,
  shouldShowBottomComposer,
  shouldShowFolderComposer,
} from './bottom-composer-gate';

const PASSING: BottomComposerGateInputs = {
  terminalVisible: false,
  agentsVisible: false,
  isEmbedded: false,
  activeDocName: 'notes',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function setDesktop(): void {
  vi.stubGlobal('window', { okDesktop: { config: {} } });
}

describe('shouldShowBottomComposer', () => {
  test('stays hidden on the web page', () => {
    expect(shouldShowBottomComposer(PASSING)).toBe(false);
  });

  test('renders on the desktop when not embedded, both panels closed, and a doc is open', () => {
    setDesktop();
    expect(shouldShowBottomComposer(PASSING)).toBe(true);
  });

  describe('each gate input independently hides the composer', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('hidden when the terminal is open', () => {
      setDesktop();
      expect(shouldShowBottomComposer({ ...PASSING, terminalVisible: true })).toBe(false);
    });

    test('hidden when the agents panel is open', () => {
      setDesktop();
      expect(shouldShowBottomComposer({ ...PASSING, agentsVisible: true })).toBe(false);
    });

    test('hidden when the host is embedded', () => {
      setDesktop();
      expect(shouldShowBottomComposer({ ...PASSING, isEmbedded: true })).toBe(false);
    });

    test('hidden when no document is open', () => {
      setDesktop();
      expect(shouldShowBottomComposer({ ...PASSING, activeDocName: null })).toBe(false);
    });
  });

  test('stays hidden when several inputs fail at once', () => {
    expect(
      shouldShowBottomComposer({
        terminalVisible: true,
        agentsVisible: true,
        isEmbedded: true,
        activeDocName: null,
      }),
    ).toBe(false);
  });
});

describe('shouldShowFolderComposer', () => {
  const PASSING_FOLDER = { terminalVisible: false, agentsVisible: false, isEmbedded: false };

  test('stays hidden on the web page', () => {
    expect(shouldShowFolderComposer(PASSING_FOLDER)).toBe(false);
  });

  test('renders on the desktop when not embedded and both panels closed', () => {
    setDesktop();
    expect(shouldShowFolderComposer(PASSING_FOLDER)).toBe(true);
  });

  test('hidden when the terminal is open', () => {
    setDesktop();
    expect(shouldShowFolderComposer({ ...PASSING_FOLDER, terminalVisible: true })).toBe(false);
  });

  test('hidden when the agents panel is open', () => {
    setDesktop();
    expect(shouldShowFolderComposer({ ...PASSING_FOLDER, agentsVisible: true })).toBe(false);
  });

  test('hidden when the host is embedded', () => {
    setDesktop();
    expect(shouldShowFolderComposer({ ...PASSING_FOLDER, isEmbedded: true })).toBe(false);
  });
});
