import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

import { sectionHeadingClasses } from './ProviderSettingsPrimitives'

interface ProviderSectionProps {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}

export default function ProviderSection({ title, description, action, children, className }: ProviderSectionProps) {
  return (
    <section className={cn('space-y-2.5', className)}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <div className={sectionHeadingClasses}>{title}</div>}
            {description && <div className="mt-1 text-[12px] text-muted-foreground">{description}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
