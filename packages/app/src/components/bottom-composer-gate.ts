import { isOkDesktopHost } from '@/components/settings/settings-host-gates';

export interface BottomComposerGateInputs {
  terminalVisible: boolean;
  agentsVisible: boolean;
  isEmbedded: boolean;
  activeDocName: string | null;
}

export function shouldShowBottomComposer(inputs: BottomComposerGateInputs): boolean {
  if (!isOkDesktopHost()) return false;
  return (
    !inputs.terminalVisible &&
    !inputs.agentsVisible &&
    !inputs.isEmbedded &&
    inputs.activeDocName !== null
  );
}

export function shouldShowFolderComposer(
  inputs: Omit<BottomComposerGateInputs, 'activeDocName'>,
): boolean {
  if (!isOkDesktopHost()) return false;
  return !inputs.terminalVisible && !inputs.agentsVisible && !inputs.isEmbedded;
}
