import { cn } from '@renderer/utils/style'
import type { FC } from 'react'

/** Shared toggle pill — boolean affordance for env toggles. */
export const TogglePill: FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-2 text-[11px] transition-colors',
      active
        ? 'border-foreground/25 bg-foreground/6 text-foreground'
        : 'border-border/50 text-muted-foreground/60 hover:border-border hover:text-foreground'
    )}>
    <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-success' : 'bg-muted-foreground/30')} />
    {label}
  </button>
)
