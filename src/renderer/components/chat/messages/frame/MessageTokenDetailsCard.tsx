import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { createDurationFormatter } from '@renderer/utils/time'
import type { AiUsageRecordEntry } from '@shared/data/types/aiUsageRecord'

import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'
import {
  buildMessagePerformanceViewModel,
  type MessagePerformanceLaneId,
  type MessagePerformanceViewModel
} from './messagePerformance'

interface MetricSegment {
  id: string
  label: string
  value: number
  colorClassName: string
}

interface InspectableMetricBarProps {
  id: string
  title: string
  summary?: string
  segments: MetricSegment[]
  formatValue: (value: number) => string
  formatPercent: (value: number) => string
  showAllDetails: boolean
}

function InspectableMetricBar({
  id,
  title,
  summary,
  segments,
  formatValue,
  formatPercent,
  showAllDetails
}: InspectableMetricBarProps) {
  const [activeSegmentId, setActiveSegmentId] = useState<string>()
  const visibleSegments = segments.filter((segment) => segment.value > 0)
  const total = visibleSegments.reduce((sum, segment) => sum + segment.value, 0)
  const activeSegment = visibleSegments.find((segment) => segment.id === activeSegmentId)

  if (total <= 0) {
    return null
  }

  return (
    <section data-testid={`metric-bar-${id}`}>
      <div
        data-testid={`metric-detail-${id}`}
        className="flex h-5 min-w-0 items-center justify-between gap-3 text-xs leading-5">
        {activeSegment ? (
          <>
            <span className="truncate font-medium text-foreground">{activeSegment.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatValue(activeSegment.value)} · {formatPercent(activeSegment.value / total)}
            </span>
          </>
        ) : (
          <>
            <span className="truncate text-muted-foreground">{title}</span>
            {summary ? <span className="shrink-0 text-foreground tabular-nums">{summary}</span> : null}
          </>
        )}
      </div>

      <div
        className="flex h-10 w-full items-stretch"
        aria-hidden="true"
        onPointerLeave={() => setActiveSegmentId(undefined)}>
        {visibleSegments.map((segment, index) => {
          const isActive = activeSegmentId === segment.id
          const isDimmed = activeSegmentId !== undefined && !isActive
          const ratio = segment.value / total

          return (
            <div
              key={segment.id}
              data-testid={`metric-segment-${id}-${segment.id}`}
              className="relative h-10 min-w-px"
              style={{ width: `${ratio * 100}%` }}
              onPointerEnter={() => setActiveSegmentId(segment.id)}>
              <span
                className={cn(
                  'absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 transition-opacity duration-150',
                  index === 0 && 'rounded-l-full',
                  index === visibleSegments.length - 1 && 'rounded-r-full',
                  segment.colorClassName,
                  isDimmed && 'opacity-35'
                )}
              />
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {visibleSegments.map((segment) => (
          <div
            key={segment.id}
            className="inline-flex items-center gap-1.5 text-[11px] leading-4 text-foreground-tertiary">
            <span className={cn('size-1.5 rounded-full', segment.colorClassName)} aria-hidden="true" />
            <span>{segment.label}</span>
            {showAllDetails ? (
              <span className="text-muted-foreground tabular-nums">
                {formatValue(segment.value)} · {formatPercent(segment.value / total)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
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

const PERFORMANCE_LANES: ReadonlyArray<{
  id: MessagePerformanceLaneId
  colorClassName: string
}> = [
  { id: 'model', colorClassName: 'bg-blue-500' },
  { id: 'tool', colorClassName: 'bg-emerald-500' },
  { id: 'approval', colorClassName: 'bg-amber-500' },
  { id: 'other', colorClassName: 'bg-neutral-400' }
]

function PerformanceTimeline({
  performance,
  formatMilliseconds,
  formatPercent,
  laneLabel,
  legacySegmentLabel,
  showAllDetails
}: {
  performance: MessagePerformanceViewModel
  formatMilliseconds: (value: number) => string
  formatPercent: (value: number) => string
  laneLabel: (lane: MessagePerformanceLaneId) => string
  legacySegmentLabel: (id: string) => string
  showAllDetails: boolean
}) {
  if (
    performance.startedAt === undefined ||
    performance.completedAt === undefined ||
    performance.completedAt <= performance.startedAt
  ) {
    return null
  }
  const total = performance.completedAt - performance.startedAt
  const legacyIntervals = performance.intervals.filter((interval) => interval.id.startsWith('legacy-'))
  if (legacyIntervals.length > 0) {
    const colors: Record<string, string> = {
      'legacy-waiting-first-token': 'bg-amber-500',
      'legacy-reasoning-time': 'bg-fuchsia-500',
      'legacy-text-generation': 'bg-blue-500'
    }
    return (
      <InspectableMetricBar
        id="request-duration"
        title={legacySegmentLabel('request-duration')}
        segments={legacyIntervals.map((interval) => ({
          id: interval.id.replace('legacy-', ''),
          label: legacySegmentLabel(interval.id),
          value: interval.completedAt - interval.startedAt,
          colorClassName: colors[interval.id] ?? 'bg-neutral-400'
        }))}
        formatValue={formatMilliseconds}
        formatPercent={formatPercent}
        showAllDetails={showAllDetails}
      />
    )
  }

  return (
    <section className="space-y-1.5" data-testid="message-performance-timeline">
      {PERFORMANCE_LANES.map((lane) => {
        const intervals = performance.intervals.filter((interval) => interval.lane === lane.id)
        return (
          <div key={lane.id} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
            <span className="truncate text-[11px] leading-4 text-foreground-tertiary">{laneLabel(lane.id)}</span>
            <div className="relative h-3 overflow-hidden rounded-sm bg-background-subtle">
              {intervals.map((interval) => {
                const left = Math.max(0, ((interval.startedAt - performance.startedAt!) / total) * 100)
                const width = Math.max(0.5, ((interval.completedAt - interval.startedAt) / total) * 100)
                const intervalLabel = interval.label ?? laneLabel(interval.lane)
                return (
                  <span
                    key={interval.id}
                    className={cn('absolute inset-y-0 rounded-sm opacity-85', lane.colorClassName)}
                    style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                    title={`${intervalLabel} · ${formatMilliseconds(interval.completedAt - interval.startedAt)}`}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}

const MessageTokenDetailsCard = ({
  message,
  records = [],
  showAllDetails = false
}: {
  message: MessageListItem
  records?: readonly AiUsageRecordEntry[]
  showAllDetails?: boolean
}) => {
  const { t, i18n } = useTranslation()
  const stats = message.stats
  const model = getMessageListItemModel(message)
  const providerName = useProviderDisplayName(model?.provider)
  const locale = i18n.resolvedLanguage
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const percentageFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }),
    [locale]
  )
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
  const totalTokens = stats.totalTokens ?? inputTokens + outputTokens
  const reasoningTokens = Math.min(Math.max(stats.outputTokenDetails?.reasoningTokens ?? 0, 0), outputTokens)
  const textOutputTokens = Math.max(outputTokens - reasoningTokens, 0)
  const inputBreakdownSegments: MetricSegment[] = [
    {
      id: 'uncached',
      label: t('chat.message.token_details.uncached'),
      value: stats.inputTokenDetails?.noCacheTokens ?? 0,
      colorClassName: 'bg-neutral-400'
    },
    {
      id: 'cache-read',
      label: t('chat.message.token_details.cache_read'),
      value: stats.inputTokenDetails?.cacheReadTokens ?? 0,
      colorClassName: 'bg-teal-500'
    },
    {
      id: 'cache-write',
      label: t('chat.message.token_details.cache_write'),
      value: stats.inputTokenDetails?.cacheWriteTokens ?? 0,
      colorClassName: 'bg-amber-500'
    }
  ]
  const performance = buildMessagePerformanceViewModel(stats, records)
  const laneLabels: Record<MessagePerformanceLaneId, string> = {
    model: t('chat.message.token_details.lane_model'),
    tool: t('chat.message.token_details.lane_tool'),
    approval: t('chat.message.token_details.lane_approval'),
    other: t('chat.message.token_details.lane_other')
  }
  const createdAt = Date.parse(message.createdAt)
  const createdAtLabel = Number.isFinite(createdAt) ? dateFormatter.format(new Date(createdAt)) : undefined
  const formatTokens = (value: number) =>
    t('chat.message.token_details.tokens', { value: numberFormatter.format(value) })
  const formatPercent = (value: number) => percentageFormatter.format(value)
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

  return (
    <div className="text-popover-foreground">
      <header className="flex min-w-0 items-start gap-2.5 p-3">
        {model ? (
          <ModelAvatar
            model={model}
            size={32}
            className="shrink-0 outline outline-1 -outline-offset-1 outline-border"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-5 font-medium text-foreground" title={model?.name}>
            {model?.name ?? model?.id ?? message.modelId}
          </div>
          {providerName ? (
            <div className="truncate text-xs leading-5 text-muted-foreground" title={providerName}>
              {providerName}
            </div>
          ) : null}
          {createdAtLabel ? (
            <time
              dateTime={message.createdAt}
              className="block truncate text-[11px] leading-4 text-foreground-tertiary"
              title={createdAtLabel}>
              {createdAtLabel}
            </time>
          ) : null}
        </div>
      </header>

      <div className="space-y-2 border-t border-border-subtle p-3">
        {costLabel ? (
          <div
            data-testid="message-cost"
            className="flex h-5 min-w-0 items-center justify-between gap-3 text-xs leading-5">
            <span className="truncate text-muted-foreground">{t('chat.message.token_details.cost')}</span>
            <span className="flex shrink-0 items-baseline gap-1.5">
              {costSourceLabel ? (
                <span className="text-[11px] leading-4 text-foreground-tertiary">{costSourceLabel}</span>
              ) : null}
              <span className="text-foreground tabular-nums">{costLabel}</span>
            </span>
          </div>
        ) : null}

        <InspectableMetricBar
          id="token-usage"
          title={t('chat.message.token_details.usage')}
          summary={formatTokens(totalTokens)}
          segments={[
            {
              id: 'input',
              label: t('chat.message.token_details.input'),
              value: inputTokens,
              colorClassName: 'bg-blue-500'
            },
            {
              id: 'output',
              label: t(
                reasoningTokens > 0 ? 'chat.message.token_details.text_output' : 'chat.message.token_details.output'
              ),
              value: textOutputTokens,
              colorClassName: 'bg-violet-500'
            },
            {
              id: 'reasoning',
              label: t('chat.message.token_details.reasoning'),
              value: reasoningTokens,
              colorClassName: 'bg-fuchsia-500'
            }
          ]}
          formatValue={formatTokens}
          formatPercent={formatPercent}
          showAllDetails={showAllDetails}
        />

        <InspectableMetricBar
          id="input-breakdown"
          title={t('chat.message.token_details.input_breakdown')}
          segments={inputBreakdownSegments}
          formatValue={formatTokens}
          formatPercent={formatPercent}
          showAllDetails={showAllDetails}
        />

        {performance.modelTokensPerSecond !== undefined ||
        performance.endToEndTokensPerSecond !== undefined ||
        performance.totalDurationMs !== undefined ? (
          <section className="space-y-1 border-t border-border-subtle pt-2" data-testid="message-performance-summary">
            {performance.modelTokensPerSecond !== undefined ? (
              <div className="flex items-center justify-between gap-3 text-xs leading-5">
                <span className="text-muted-foreground">{t('chat.message.token_details.model_throughput')}</span>
                <span className="text-foreground tabular-nums">
                  {t('chat.message.token_details.tokens_per_second_value', {
                    value: decimalFormatter.format(performance.modelTokensPerSecond)
                  })}
                </span>
              </div>
            ) : null}
            {performance.endToEndTokensPerSecond !== undefined ? (
              <div className="flex items-center justify-between gap-3 text-xs leading-5">
                <span className="text-muted-foreground">{t('chat.message.token_details.end_to_end_throughput')}</span>
                <span className="text-foreground tabular-nums">
                  {t('chat.message.token_details.tokens_per_second_value', {
                    value: decimalFormatter.format(performance.endToEndTokensPerSecond)
                  })}
                </span>
              </div>
            ) : null}
            {performance.totalDurationMs !== undefined ? (
              <div className="flex items-center justify-between gap-3 text-xs leading-5">
                <span className="text-muted-foreground">{t('chat.message.token_details.total_duration')}</span>
                <span className="text-foreground tabular-nums">{formatMilliseconds(performance.totalDurationMs)}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        <PerformanceTimeline
          performance={performance}
          formatMilliseconds={formatMilliseconds}
          formatPercent={formatPercent}
          laneLabel={(lane) => laneLabels[lane]}
          legacySegmentLabel={(id) => {
            switch (id) {
              case 'legacy-waiting-first-token':
                return t('chat.message.token_details.waiting_first_token')
              case 'legacy-reasoning-time':
                return t('chat.message.token_details.reasoning_time')
              case 'legacy-text-generation':
                return t('chat.message.token_details.text_generation')
              default:
                return t('chat.message.token_details.request_duration')
            }
          }}
          showAllDetails={showAllDetails}
        />
      </div>
    </div>
  )
}

export default MessageTokenDetailsCard
