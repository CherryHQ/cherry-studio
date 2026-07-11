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
  layout?: 'vertical' | 'horizontal'
}

export default function ProviderField({
  title,
  titleClassName,
  action,
  help,
  children,
  className,
  layout = 'vertical'
}: ProviderFieldProps) {
  const isHorizontal = layout === 'horizontal'

  return (
    <div
      className={cn(
        'space-y-2',
        className,
        isHorizontal && 'grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 space-y-0'
      )}>
      <div className={cn('flex items-center justify-between gap-3', isHorizontal && 'min-h-8 justify-start')}>
        <div className={cn('font-semibold text-foreground-secondary text-sm leading-5', titleClassName)}>{title}</div>
        {action}
      </div>
      {children}
      {help && isHorizontal ? <div className="col-start-2">{help}</div> : help}
    </div>
  )
}
