import { useLingui } from '@lingui/react/macro';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { Loader2Icon } from '@/lib/host-icons';
import { cn } from '@/lib/utils';

function Spinner({
  className,
  icon: Icon = Loader2Icon,
  ...props
}: LucideProps & { icon?: LucideIcon }) {
  const { t } = useLingui();

  return (
    <Icon
      role="status"
      aria-label={t`Loading`}
      // oxlint-disable-next-line ok/no-hand-rolled-spinner -- this is the primitive the rule points callers to
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

export { Spinner };
