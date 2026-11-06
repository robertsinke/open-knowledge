import { incrementJsxRenderFailure } from '@inkeep/open-knowledge-core/metrics/parse-health';
import { useLingui } from '@lingui/react/macro';
import type { ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Search } from '@/lib/host-icons';
import { formatShortcut } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

export const OPEN_COMMAND_PALETTE_EVENT = 'ok:open-command-palette';

export function requestOpenCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

interface HeaderSearchBarProps {
  onClick: () => void;
  className?: string;
}

export function onPillRenderError(error: unknown, info: ErrorInfo): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.warn(
    JSON.stringify({
      event: 'jsx-render-failure',
      component: 'headerSearchPill',
      rawComponentName: 'headerSearchPill',
      error: String(err),
      stack: info.componentStack,
    }),
  );
  incrementJsxRenderFailure('headerSearchPill');
}

export function HeaderSearchBar({ onClick, className }: HeaderSearchBarProps) {
  const { t } = useLingui();
  const label = t`Search`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          data-telemetry-event="ok.app_header.search.click"
          className={cn('shrink-0 text-muted-foreground', className)}
        >
          <Search aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <Kbd className="text-foreground/70">{formatShortcut('command-palette')}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
