import { type ComponentPropsWithoutRef, type CSSProperties, type Ref } from 'react'

import { cn } from '@renderer/utils/style'

import { getContextUsageColor, normalizeContextUsagePercentage } from './contextUsageColor'

interface ContextUsageMeterProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  ref?: Ref<HTMLSpanElement>
  label: string
  percentage: number
  isBusy?: boolean
}

export function ContextUsageMeter({
  ref,
  label,
  percentage,
  isBusy = false,
  className,
  style,
  ...props
}: ContextUsageMeterProps) {
  const normalizedPercentage = normalizeContextUsagePercentage(percentage)
  const color = getContextUsageColor(normalizedPercentage)

  return (
    <span
      {...props}
      ref={ref}
      role="meter"
      tabIndex={0}
      aria-label={`${label} ${normalizedPercentage}%`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalizedPercentage}
      aria-busy={isBusy || undefined}
      className={cn(
        'relative inline-grid size-5 shrink-0 place-items-center rounded-full bg-[conic-gradient(var(--context-usage-color)_var(--context-usage-progress),var(--border-subtle)_0)]',
        isBusy && 'animate-pulse',
        className
      )}
      style={
        {
          ...style,
          '--context-usage-color': color,
          '--context-usage-progress': `${normalizedPercentage}%`
        } as CSSProperties
      }>
      <span aria-hidden className="absolute inset-[2px] rounded-full bg-card" />
    </span>
  )
}
