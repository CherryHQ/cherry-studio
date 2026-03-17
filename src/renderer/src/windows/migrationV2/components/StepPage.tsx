import { cn } from '@cherrystudio/ui/lib/utils'
import React from 'react'

interface StepPageProps {
  title: string
  description?: string
  children: React.ReactNode
  align?: 'start' | 'center'
  leading?: React.ReactNode
  headerClassName?: string
}

export const StepPage: React.FC<StepPageProps> = ({
  title,
  description,
  children,
  align = 'start',
  leading,
  headerClassName
}) => {
  return (
    <div className={cn('space-y-8', align === 'center' && 'text-center')}>
      <div
        className={cn(
          'space-y-3',
          headerClassName,
          align === 'center' && 'mx-auto flex max-w-xl flex-col items-center'
        )}>
        {leading}
        <h1 className="max-w-2xl font-semibold text-[34px] text-foreground tracking-[-0.03em]">{title}</h1>
        {description ? <p className="max-w-2xl text-base text-muted-foreground leading-8">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">{children}</p>
}
