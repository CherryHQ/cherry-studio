import { Skeleton } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

type LoadingStateVariant = 'spinner' | 'skeleton'

export interface LoadingStateProps extends ComponentProps<'div'> {
  description?: ReactNode
  label?: ReactNode
  rows?: number
  variant?: LoadingStateVariant
}

export function LoadingState({
  className,
  description,
  label,
  rows = 3,
  variant = 'spinner',
  ...props
}: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <div
        data-slot="chat-loading-state"
        role="status"
        aria-live="polite"
        className={cn('space-y-2', className)}
        {...props}>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className={cn('h-4', index === rows - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    )
  }

  return (
    <div
      data-slot="chat-loading-state"
      role="status"
      aria-live="polite"
      className={cn('flex min-w-0 items-center gap-2 text-muted-foreground text-sm', className)}
      {...props}>
      <Loader2 className="size-4 shrink-0 animate-spin" />
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block truncate text-foreground">{label}</span>}
          {description && <span className="block truncate text-muted-foreground text-xs">{description}</span>}
        </span>
      )}
    </div>
  )
}
