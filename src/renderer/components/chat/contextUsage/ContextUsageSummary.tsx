import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'

import { getContextUsageColor, normalizeContextUsagePercentage } from './contextUsageColor'

export interface ContextUsageSummaryData {
  estimated?: boolean
  usedTokens: number
  maxTokens: number
  percentage: number
  modelName: string
  segments?: { label: string; tokens: number; color: string }[]
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
  const { i18n } = useTranslation()
  const percentage = data ? normalizeContextUsagePercentage(data.percentage) : null
  const color = percentage === null ? undefined : getContextUsageColor(percentage)

  return (
    <section className={cn('space-y-2 text-xs', className)} aria-busy={isBusy || undefined}>
      <h3 className="font-medium text-foreground">{title}</h3>
      {data && percentage !== null ? (
        <div className="space-y-2">
          <div
            role="meter"
            aria-label={title}
            aria-valuemin={0}
            aria-valuemax={data.maxTokens}
            aria-valuenow={Math.min(data.maxTokens, Math.max(0, data.usedTokens))}
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-background-subtle">
            {data.segments?.length ? (
              data.segments.map((segment) => (
                <div
                  key={segment.label}
                  title={segment.label}
                  className={cn('h-full shrink-0', isBusy && 'animate-pulse')}
                  style={{
                    width: `${Math.min(100, Math.max(0, (segment.tokens / data.maxTokens) * 100))}%`,
                    background: segment.color
                  }}
                />
              ))
            ) : (
              <div
                className={cn('h-full rounded-full', isBusy && 'animate-pulse')}
                style={{ width: `${percentage}%`, background: color }}
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <span className="shrink-0">
              {data.estimated ? '≈' : ''}
              {data.usedTokens.toLocaleString(i18n.resolvedLanguage)} /{' '}
              {data.maxTokens.toLocaleString(i18n.resolvedLanguage)} ({percentage}%)
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
