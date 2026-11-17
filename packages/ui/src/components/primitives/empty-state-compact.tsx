import type { LucideIcon } from 'lucide-react'
import { Inbox, Info } from 'lucide-react'
import type { ReactNode } from 'react'

import { EmptyStateMark } from '@cherrystudio/ui/components/primitives/empty-state-mark'
import { cn } from '@cherrystudio/ui/lib/utils'

/** T1 — an empty group or list inside a sidebar: one dashed row in the list's own rhythm. */
export function EmptyStateRow({
  icon: Icon,
  children,
  className
}: {
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state-row"
      className={cn(
        'flex min-h-7 items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-foreground-tertiary',
        className
      )}>
      {Icon && <Icon size={13} strokeWidth={1.8} aria-hidden className="shrink-0" />}
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/** T4 — an empty slot inside a form or card that can be filled in place. */
export function EmptyPlaceholder({
  icon = Inbox,
  title,
  description,
  action,
  className
}: {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-placeholder"
      className={cn(
        'flex items-center gap-3 rounded-xl border border-dashed border-border-strong px-3 py-2.5',
        className
      )}>
      <EmptyStateMark icon={icon} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** T6 — a standalone read-only note inside a dialog, tool result or settings row. */
export function EmptyNote({
  icon: Icon = Info,
  children,
  className
}: {
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-note"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-border-subtle bg-background-subtle px-3 py-2.5 text-xs leading-5 text-muted-foreground',
        className
      )}>
      <Icon size={14} strokeWidth={1.8} aria-hidden className="mt-0.5 shrink-0 text-foreground-tertiary" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
