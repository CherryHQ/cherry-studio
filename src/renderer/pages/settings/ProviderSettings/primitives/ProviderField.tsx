import { HStack } from '@cherrystudio/ui'
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
      <HStack gap={3} className="justify-between">
        <div
          className={cn(
            'font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-sm)] text-foreground-secondary leading-[var(--line-height-body-sm)]',
            titleClassName
          )}>
          {title}
        </div>
        {action}
      </HStack>
      {children}
      {help}
    </div>
  )
}
