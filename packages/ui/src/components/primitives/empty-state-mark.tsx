import type { LucideIcon } from 'lucide-react'
import { SearchX } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

/** Small top-lit tile carrying an icon: the compact empty-state mark for pickers, lists and tables. */
export function EmptyStateMark({ icon: Icon = SearchX, className }: { icon?: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="empty-state-mark"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] border border-border border-t-border-strong bg-card text-muted-foreground shadow-xs',
        className
      )}>
      <Icon size={14} strokeWidth={1.8} />
    </span>
  )
}

/**
 * Compact empty message: plain-text content gets an `EmptyStateMark` above it,
 * while caller-provided nodes (a full `EmptyState`, custom markup) render unchanged.
 */
export function EmptyStateMessage({
  icon,
  children,
  className
}: {
  icon?: LucideIcon
  children?: ReactNode
  className?: string
}) {
  if (typeof children !== 'string' && typeof children !== 'number') return <>{children}</>
  return (
    <div className={cn('flex flex-col items-center gap-2 text-center', className)}>
      <EmptyStateMark icon={icon} />
      <span>{children}</span>
    </div>
  )
}
