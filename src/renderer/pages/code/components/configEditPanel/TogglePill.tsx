import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { FC } from 'react'

/** Shared toggle pill — boolean affordance for env toggles. */
export const TogglePill: FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      'h-auto min-h-0 gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-[11px] shadow-none',
      active
        ? 'border-foreground/25 bg-foreground/6 text-foreground'
        : 'border-border/50 text-muted-foreground/60 hover:border-border hover:text-foreground'
    )}>
    <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-success' : 'bg-muted-foreground/30')} />
    {label}
  </Button>
)
