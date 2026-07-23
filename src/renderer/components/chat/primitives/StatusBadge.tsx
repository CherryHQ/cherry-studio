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
  loading: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
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
