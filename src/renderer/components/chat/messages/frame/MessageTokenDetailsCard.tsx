import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { createDurationFormatter } from '@renderer/utils/time'
import type { AiUsageRecordEntry } from '@shared/data/types/aiUsageRecord'
import { ChevronDown } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'
import {
  buildMessagePerformanceViewModel,
  type MessagePerformanceLaneId,
  type MessagePerformanceViewModel
} from './messagePerformance'

const PRIMARY_METRIC_FONT_SIZES = [16, 14, 12, 10] as const

function fitPrimaryMetricValue(element: HTMLElement) {
  element.style.whiteSpace = 'nowrap'
  element.style.overflowWrap = 'normal'

  for (const fontSize of PRIMARY_METRIC_FONT_SIZES) {
    element.style.fontSize = `${fontSize}px`
    if (element.scrollWidth <= element.clientWidth) return
  }

  element.style.whiteSpace = 'normal'
  element.style.overflowWrap = 'anywhere'
}

function PrimaryMetric({ label, value, testId }: { label: string; value: string; testId: string }) {
  const valueRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const element = valueRef.current
    if (!element) return

    fitPrimaryMetricValue(element)
    const handleResize = () => fitPrimaryMetricValue(element)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [value])

  return (
    <div data-testid={testId} className="min-w-0 rounded-md bg-background-subtle px-3 py-2.5">
      <dt className="truncate text-[11px] text-muted-foreground leading-4" title={label}>
        {label}
      </dt>
      <dd
        ref={valueRef}
        className="mt-1 whitespace-nowrap font-semibold text-base text-foreground tabular-nums leading-5"
        title={value}>
        {value}
      </dd>
    </div>
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-foreground-tertiary leading-4">{label}</dt>
      <dd className="truncate text-muted-foreground text-xs tabular-nums leading-5" title={value}>
        {value}
      </dd>
    </div>
  )
}

const PERFORMANCE_LANES: readonly MessagePerformanceLaneId[] = ['model', 'tool', 'approval', 'other']

function PerformanceBreakdown({
  performance,
  formatMilliseconds,
  laneLabel,
  legacySegmentLabel
}: {
  performance: MessagePerformanceViewModel
  formatMilliseconds: (value: number) => string
  laneLabel: (lane: MessagePerformanceLaneId) => string
  legacySegmentLabel: (id: string) => string
}) {
  if (
    performance.startedAt === undefined ||
    performance.completedAt === undefined ||
    performance.completedAt <= performance.startedAt
  ) {
    return null
  }

  const totalDuration = performance.completedAt - performance.startedAt
  const legacyIntervals = performance.intervals.filter((interval) => interval.id.startsWith('legacy-'))

  if (legacyIntervals.length > 0) {
    return (
      <div className="space-y-2" data-testid="message-performance-breakdown">
        {legacyIntervals.map((interval) => {
          const duration = interval.completedAt - interval.startedAt
          const width = Math.max(2, (duration / totalDuration) * 100)

          return (
            <div key={interval.id}>
              <div className="mb-1 flex items-center justify-between gap-3 text-[11px] leading-4">
                <span className="truncate text-muted-foreground">{legacySegmentLabel(interval.id)}</span>
                <span className="shrink-0 text-foreground-tertiary tabular-nums">{formatMilliseconds(duration)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-background-subtle">
                <span className="block h-full rounded-full bg-foreground/55" style={{ width: `${width}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const visibleLanes = PERFORMANCE_LANES.map((lane) => ({
    lane,
    intervals: performance.intervals.filter((interval) => interval.lane === lane)
  })).filter(({ intervals }) => intervals.length > 0)

  if (visibleLanes.length === 0) return null

  return (
    <div className="space-y-2" data-testid="message-performance-breakdown">
      {visibleLanes.map(({ lane, intervals }) => (
        <div key={lane} className="grid grid-cols-[4rem_1fr] items-center gap-2">
          <span className="truncate text-[11px] text-muted-foreground leading-4">{laneLabel(lane)}</span>
          <div className="relative h-2 overflow-hidden rounded-full bg-background-subtle">
            {intervals.map((interval) => {
              const left = Math.max(0, ((interval.startedAt - performance.startedAt!) / totalDuration) * 100)
              const width = Math.max(0.75, ((interval.completedAt - interval.startedAt) / totalDuration) * 100)
              const label = interval.label ?? laneLabel(interval.lane)

              return (
                <span
                  key={interval.id}
                  className={cn(
                    'absolute inset-y-0 rounded-full',
                    lane === 'other' ? 'bg-foreground/20' : 'bg-foreground/55'
                  )}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  title={`${label} · ${formatMilliseconds(interval.completedAt - interval.startedAt)}`}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Below this floor a real cost would render as an exact zero, which is
 * indistinguishable from an unpriced request — show it as a "less than" instead.
 */
const COST_DISPLAY_FLOOR = 0.0001

function formatCost(cost: number, currencyFormatter: Intl.NumberFormat): string {
  if (cost > 0 && cost < COST_DISPLAY_FLOOR) {
    return `<${currencyFormatter.format(COST_DISPLAY_FLOOR)}`
  }

  return currencyFormatter.format(cost)
}

const MessageTokenDetailsCard = ({
  message,
  records = [],
  showMoreDetails = false,
  isLoadingDetails = false,
  onShowMoreDetailsChange
}: {
  message: MessageListItem
  records?: readonly AiUsageRecordEntry[]
  showMoreDetails?: boolean
  isLoadingDetails?: boolean
  onShowMoreDetailsChange?: (show: boolean) => void
}) => {
  const { t, i18n } = useTranslation()
  const moreDetailsId = useId()
  const stats = message.stats
  const model = getMessageListItemModel(message)
  const providerName = useProviderDisplayName(model?.provider)
  const locale = i18n.resolvedLanguage
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const decimalFormatter = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale])
  const durationFormatter = useMemo(() => createDurationFormatter(locale), [locale])
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
    [locale]
  )

  if (!stats) {
    return null
  }

  const inputTokens = stats.inputTokens ?? 0
  const outputTokens = stats.outputTokens ?? 0
  const reasoningTokens = Math.min(Math.max(stats.outputTokenDetails?.reasoningTokens ?? 0, 0), outputTokens)
  const cacheReadTokens = stats.inputTokenDetails?.cacheReadTokens ?? 0
  const cacheWriteTokens = stats.inputTokenDetails?.cacheWriteTokens ?? 0
  const noCacheTokens = stats.inputTokenDetails?.noCacheTokens ?? 0
  const performance = buildMessagePerformanceViewModel(stats, records)
  const createdAt = Date.parse(message.createdAt)
  const createdAtLabel = Number.isFinite(createdAt) ? dateFormatter.format(new Date(createdAt)) : undefined
  const formatTokens = (value: number) =>
    t('chat.message.token_details.tokens', { value: numberFormatter.format(value) })
  const formatMilliseconds = durationFormatter
  const costLabel = stats.costs
    ?.map((cost) =>
      formatCost(
        cost.amount,
        new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: cost.currency,
          maximumFractionDigits: 4
        })
      )
    )
    .join(' · ')
  const providerReportedRequestCount =
    stats.costs?.reduce((sum, cost) => sum + cost.providerReportedRequestCount, 0) ?? 0
  const computedRequestCount = stats.costs?.reduce((sum, cost) => sum + cost.computedRequestCount, 0) ?? 0
  const costSourceLabel =
    providerReportedRequestCount > 0 && computedRequestCount === 0
      ? t('chat.message.token_details.cost_billed')
      : computedRequestCount > 0 && providerReportedRequestCount === 0
        ? t('chat.message.token_details.cost_estimated')
        : undefined
  const speedLabel =
    performance.modelTokensPerSecond === undefined
      ? '—'
      : t('chat.message.token_details.tokens_per_second_value', {
          value: decimalFormatter.format(performance.modelTokensPerSecond)
        })
  const detailMetrics = [
    reasoningTokens > 0
      ? {
          id: 'reasoning',
          label: t('chat.message.token_details.reasoning'),
          value: formatTokens(reasoningTokens)
        }
      : undefined,
    cacheReadTokens > 0
      ? {
          id: 'cache-read',
          label: t('chat.message.token_details.cache_read'),
          value: formatTokens(cacheReadTokens)
        }
      : undefined,
    cacheWriteTokens > 0
      ? {
          id: 'cache-write',
          label: t('chat.message.token_details.cache_write'),
          value: formatTokens(cacheWriteTokens)
        }
      : undefined,
    noCacheTokens > 0
      ? {
          id: 'uncached',
          label: t('chat.message.token_details.uncached'),
          value: formatTokens(noCacheTokens)
        }
      : undefined,
    performance.endToEndTokensPerSecond !== undefined
      ? {
          id: 'end-to-end-throughput',
          label: t('chat.message.token_details.end_to_end_throughput'),
          value: t('chat.message.token_details.tokens_per_second_value', {
            value: decimalFormatter.format(performance.endToEndTokensPerSecond)
          })
        }
      : undefined,
    performance.totalDurationMs !== undefined
      ? {
          id: 'total-duration',
          label: t('chat.message.token_details.total_duration'),
          value: formatMilliseconds(performance.totalDurationMs)
        }
      : undefined
  ].filter((metric): metric is { id: string; label: string; value: string } => metric !== undefined)
  const hasPerformanceBreakdown =
    performance.startedAt !== undefined &&
    performance.completedAt !== undefined &&
    performance.completedAt > performance.startedAt &&
    performance.intervals.length > 0
  const laneLabels: Record<MessagePerformanceLaneId, string> = {
    model: t('chat.message.token_details.lane_model'),
    tool: t('chat.message.token_details.lane_tool'),
    approval: t('chat.message.token_details.lane_approval'),
    other: t('chat.message.token_details.lane_other')
  }

  return (
    <div className="text-popover-foreground">
      <header className="flex min-w-0 items-center gap-2.5 p-3">
        {model ? (
          <ModelAvatar
            model={model}
            size={32}
            className="-outline-offset-1 shrink-0 outline outline-1 outline-border"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground text-sm leading-5" title={model?.name}>
            {model?.name ?? model?.id ?? message.modelId}
          </div>
          {providerName ? (
            <div className="truncate text-muted-foreground text-xs leading-5" title={providerName}>
              {providerName}
            </div>
          ) : null}
        </div>
        {createdAtLabel ? (
          <time
            dateTime={message.createdAt}
            className="max-w-40 shrink-0 truncate text-right text-[11px] text-foreground-tertiary leading-4"
            title={createdAtLabel}>
            {createdAtLabel}
          </time>
        ) : null}
      </header>

      <div className="space-y-3 border-border-subtle border-t p-3">
        <dl className="grid grid-cols-3 gap-2" data-testid="message-primary-metrics">
          <PrimaryMetric
            testId="message-metric-input"
            label={t('chat.message.token_details.input')}
            value={formatTokens(inputTokens)}
          />
          <PrimaryMetric
            testId="message-metric-output"
            label={t('chat.message.token_details.output')}
            value={formatTokens(outputTokens)}
          />
          <PrimaryMetric
            testId="message-metric-speed"
            label={t('chat.message.token_details.model_throughput')}
            value={speedLabel}
          />
        </dl>

        {costLabel ? (
          <div
            data-testid="message-cost"
            className="flex min-w-0 items-center justify-between gap-3 border-border-subtle border-y py-2 text-xs leading-5">
            <span className="truncate text-foreground-tertiary">{t('chat.message.token_details.cost')}</span>
            <span className="flex shrink-0 items-center gap-1.5 leading-5">
              {costSourceLabel ? (
                <span className="text-[11px] text-foreground-tertiary leading-5">{costSourceLabel}</span>
              ) : null}
              <span className="text-foreground tabular-nums leading-5">{costLabel}</span>
            </span>
          </div>
        ) : null}

        {detailMetrics.length > 0 ? (
          <dl
            className={cn('grid grid-cols-2 gap-x-4 gap-y-2', !costLabel && 'border-border-subtle border-t pt-2')}
            data-testid="message-secondary-metrics">
            {detailMetrics.map((metric) => (
              <DetailMetric key={metric.id} label={metric.label} value={metric.value} />
            ))}
          </dl>
        ) : null}

        {hasPerformanceBreakdown ? (
          <div className={cn('pt-1', (detailMetrics.length > 0 || !costLabel) && 'border-border-subtle border-t')}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-between px-1 text-muted-foreground shadow-none"
              aria-expanded={showMoreDetails}
              aria-controls={moreDetailsId}
              onClick={() => onShowMoreDetailsChange?.(!showMoreDetails)}>
              {t(
                showMoreDetails ? 'chat.message.token_details.less_details' : 'chat.message.token_details.more_details'
              )}
              <ChevronDown
                aria-hidden="true"
                className={cn('size-3.5 transition-transform duration-150', showMoreDetails && 'rotate-180')}
              />
            </Button>

            {showMoreDetails ? (
              <section id={moreDetailsId} className="space-y-2 pt-2">
                <h3 className="font-medium text-foreground text-xs leading-5">
                  {t('chat.message.token_details.runtime_breakdown')}
                </h3>
                {isLoadingDetails ? (
                  <div className="text-[11px] text-foreground-tertiary leading-4">{t('common.loading')}</div>
                ) : (
                  <PerformanceBreakdown
                    performance={performance}
                    formatMilliseconds={formatMilliseconds}
                    laneLabel={(lane) => laneLabels[lane]}
                    legacySegmentLabel={(id) => {
                      switch (id) {
                        case 'legacy-waiting-first-token':
                          return t('chat.message.token_details.waiting_first_token')
                        case 'legacy-reasoning-time':
                          return t('chat.message.token_details.reasoning_time')
                        default:
                          return t('chat.message.token_details.text_generation')
                      }
                    }}
                  />
                )}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default MessageTokenDetailsCard
