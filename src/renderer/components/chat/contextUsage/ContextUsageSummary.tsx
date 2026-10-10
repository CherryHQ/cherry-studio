import type { ReactNode } from 'react'

import { cn } from '@renderer/utils/style'

import { getContextUsageColor, normalizeContextUsagePercentage } from './contextUsageColor'

export interface ContextUsageSummaryData {
  usedTokens: number
  maxTokens: number
  percentage: number
  modelName: string
}

interface ContextUsageSummaryProps {
  title: string
  emptyLabel: string
  data: ContextUsageSummaryData | null
  className?: string
  isBusy?: boolean
  children?: ReactNode
}

export function ContextUsageSummary({
  title,
  emptyLabel,
  data,
  className,
  isBusy = false,
  children
}: ContextUsageSummaryProps) {
  const percentage = data ? normalizeContextUsagePercentage(data.percentage) : null
  const color = percentage === null ? undefined : getContextUsageColor(percentage)

  return (
    <section className={cn('space-y-2 text-xs', className)} aria-busy={isBusy || undefined}>
      <h3 className="font-medium text-foreground">{title}</h3>
      {data && percentage !== null ? (
        <div className="space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-subtle">
            <div
              className={cn('h-full rounded-full', isBusy && 'animate-pulse')}
              style={{ width: `${percentage}%`, background: color }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <span className="shrink-0">
              {data.usedTokens.toLocaleString()} / {data.maxTokens.toLocaleString()} ({percentage}%)
            </span>
            <span className="min-w-0 truncate">{data.modelName}</span>
          </div>
          {children}
        </div>
      ) : (
        <p className="text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  )
}
