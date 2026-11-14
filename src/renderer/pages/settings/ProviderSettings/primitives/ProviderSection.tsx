import type { ReactNode } from 'react'

import { HelpTooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

import { sectionHeadingClasses } from './ProviderSettingsPrimitives'

interface ProviderSectionProps {
  id?: string
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}

export default function ProviderSection({ id, title, description, action, children, className }: ProviderSectionProps) {
  return (
    <section id={id} className={cn('space-y-2.5', className)}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <div className={cn(sectionHeadingClasses, 'flex items-center gap-1.5')}>
                {title}
                {description && <HelpTooltip content={description} delay={1000} />}
              </div>
            )}
            {!title && description && <HelpTooltip content={description} delay={1000} />}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
