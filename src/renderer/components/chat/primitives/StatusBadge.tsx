import { Badge } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

type StatusBadgeStatus = 'idle' | 'loading' | 'success' | 'warning' | 'error' | 'info' | 'muted'

export interface StatusBadgeProps extends ComponentProps<typeof Badge> {
  icon?: ReactNode
  pulse?: boolean
  status?: StatusBadgeStatus
}

const statusClassNames: Record<StatusBadgeStatus, string> = {
  idle: 'bg-secondary text-secondary-foreground',
  loading: 'border-info-border bg-info-subtle text-info-subtle-foreground',
  success: 'border-success-border bg-success-subtle text-success-subtle-foreground',
  warning: 'border-warning-border bg-warning-subtle text-warning-subtle-foreground',
  error: 'border-error-border bg-error-subtle text-error-subtle-foreground',
  info: 'border-info-border bg-info-subtle text-info-subtle-foreground',
  muted: 'bg-muted text-muted-foreground'
}

export function StatusBadge({
  children,
  className,
  icon,
  pulse = false,
  status = 'idle',
  variant = 'secondary',
  ...props
}: StatusBadgeProps) {
  return (
    <Badge
      data-slot="chat-status-badge"
      variant={variant}
      className={cn('gap-1 border-transparent', statusClassNames[status], className)}
      {...props}>
      {pulse && <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />}
      {icon}
      {children}
    </Badge>
  )
}
