import { ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
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
  collapsible?: boolean
  description?: string
  children?: ReactNode
}

export function ContextUsageSummary({
  title,
  emptyLabel,
  data,
  className,
  isBusy = false,
  collapsible = false,
  description,
  children
}: ContextUsageSummaryProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const percentage = data ? normalizeContextUsagePercentage(data.percentage) : null
  const color = percentage === null ? undefined : getContextUsageColor(percentage)

  const exact = (tokens: number) => tokens.toLocaleString(i18n.resolvedLanguage)
  const compact = (tokens: number) => tokens.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
  const details = [data?.estimated && t('chat.message.token_details.cost_estimated'), description]
    .filter(Boolean)
    .join(' · ')
  const content =
    data && percentage !== null ? (
      <div className="space-y-2">
        {collapsible && (
          <div className="flex items-center justify-between gap-2 tabular-nums">
            <span>{t('agent.right_pane.info.context_used', { percent: percentage })}</span>
            <span
              className="text-muted-foreground"
              title={`${exact(data.usedTokens)} / ${exact(data.maxTokens)}${details ? ` · ${details}` : ''}`}>
              {compact(data.usedTokens)} / {compact(data.maxTokens)}
            </span>
          </div>
        )}
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
              style={{ width: `${percentage}%`, background: collapsible ? 'var(--chart-1)' : color }}
            />
          )}
        </div>
        {!collapsible && (
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <span className="shrink-0" title={details || undefined}>
              {data.usedTokens.toLocaleString(i18n.resolvedLanguage)} /{' '}
              {data.maxTokens.toLocaleString(i18n.resolvedLanguage)} ({percentage}%)
            </span>
            <span className="min-w-0 truncate">{data.modelName}</span>
          </div>
        )}
        {children}
      </div>
    ) : (
      <p className="text-muted-foreground">{emptyLabel}</p>
    )

  return (
    <section className={cn('space-y-2 text-xs', className)} aria-label={title} aria-busy={isBusy || undefined}>
      {collapsible ? (
        <Accordion
          type="single"
          collapsible
          value={open ? 'context' : ''}
          onValueChange={(value) => setOpen(value === 'context')}>
          <AccordionItem value="context" className="border-0 first:border-t-0">
            <AccordionTrigger
              aria-label={title}
              className="group gap-2 py-1 text-xs font-normal text-foreground [&>svg]:hidden">
              <span className="flex items-center gap-1">
                {title}
                <ChevronRight
                  aria-hidden
                  className="size-3 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                />
              </span>
              {!open && (
                <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                  {percentage === null ? emptyLabel : `${percentage}%`}
                  {percentage !== null && (
                    <span aria-hidden className="h-1.5 w-6 overflow-hidden rounded-full bg-background-subtle">
                      <span
                        className={cn('block h-full rounded-full bg-chart-1', isBusy && 'animate-pulse')}
                        style={{ width: `${percentage}%` }}
                      />
                    </span>
                  )}
                </span>
              )}
            </AccordionTrigger>
            <AccordionContent className="pt-2 pb-0 text-xs text-foreground">{content}</AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <>
          <h3 className="font-medium text-foreground">{title}</h3>
          {content}
        </>
      )}
    </section>
  )
}
