import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

interface ProviderFieldProps {
  title: ReactNode
  /** Merged onto the title row; use to override label color/weight when needed. */
  titleClassName?: string
  action?: ReactNode
  help?: ReactNode
  children: ReactNode
  className?: string
  /** When true, render label on the left and control on the right in a single row (default: false = stacked). */
  horizontal?: boolean
  /** Merged onto the right-side control wrapper in horizontal mode. */
  controlClassName?: string
}

export default function ProviderField({
  title,
  titleClassName,
  action,
  help,
  children,
  className,
  horizontal = false,
  controlClassName
}: ProviderFieldProps) {
  if (horizontal) {
    return (
      <div className="flex flex-col gap-1">
        <div className={cn('flex min-h-8 items-center justify-between gap-3', className)}>
          <div
            className={cn(
              'text-(length:--font-size-body-xs) shrink-0 font-medium text-foreground-secondary leading-(--line-height-body-xs)',
              titleClassName
            )}>
            {title}
          </div>
          <div className={cn('flex w-44 shrink-0 items-center justify-end gap-2', controlClassName)}>
            {children}
            {action}
          </div>
        </div>
        {help}
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <div
          className={cn(
            'text-(length:--font-size-body-sm) font-medium text-foreground-secondary leading-(--line-height-body-sm)',
            titleClassName
          )}>
          {title}
        </div>
        {action}
      </div>
      {children}
      {help}
    </div>
  )
}
