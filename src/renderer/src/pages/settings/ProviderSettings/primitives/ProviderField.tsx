import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

interface ProviderFieldProps {
  title: ReactNode
  /** Merged onto the title row; use to override label color/weight when needed. */
  titleClassName?: string
  action?: ReactNode
  help?: ReactNode
  children: ReactNode
  className?: string
}

export default function ProviderField({
  title,
  titleClassName,
  action,
  help,
  children,
  className
}: ProviderFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <div
          className={cn(
            // Draft: field labels use muted foreground (e.g. text-foreground/65), not /85 — plain string titles inherit this.
            'font-medium text-[13px] text-foreground/65 leading-[1.35]',
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
