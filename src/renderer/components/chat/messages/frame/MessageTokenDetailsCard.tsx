import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'

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
            <span className="shrink-0 text-foreground-secondary tabular-nums">
              {formatValue(activeSegment.value)} · {formatPercent(activeSegment.value / total)}
            </span>
          </>
        ) : (
          <>
            <span className="truncate text-foreground-secondary">{title}</span>
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
                  '-translate-y-1/2 absolute inset-x-0 top-1/2 h-2 transition-opacity duration-150',
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
            className="inline-flex items-center gap-1.5 text-[11px] text-foreground-muted leading-4">
            <span className={cn('size-1.5 rounded-full', segment.colorClassName)} aria-hidden="true" />
            <span>{segment.label}</span>
            {showAllDetails ? (
              <span className="text-foreground-secondary tabular-nums">
                {formatValue(segment.value)} · {formatPercent(segment.value / total)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function formatDuration(durationMs: number, numberFormatter: Intl.NumberFormat): string {
  if (durationMs < 1000) {
    return `${numberFormatter.format(Math.round(durationMs))}ms`
  }

  const durationSeconds = durationMs / 1000
  if (durationSeconds < 60) {
    return `${numberFormatter.format(Number(durationSeconds.toFixed(1)))}s`
  }

  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${numberFormatter.format(minutes)}m ${numberFormatter.format(Number(seconds.toFixed(1)))}s`
}

const MessageTokenDetailsCard = ({
  message,
  showAllDetails = false
}: {
  message: MessageListItem
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
  const firstTokenDurationMs =
    stats.timeFirstTokenMs !== undefined && stats.timeCompletionMs !== undefined
      ? Math.min(stats.timeFirstTokenMs, stats.timeCompletionMs)
      : undefined
  const reasoningDurationMs =
    stats.timeCompletionMs !== undefined && stats.timeThinkingMs !== undefined
      ? Math.min(Math.max(stats.timeThinkingMs, 0), stats.timeCompletionMs)
      : 0
  const waitingFirstTokenDurationMs =
    firstTokenDurationMs !== undefined
      ? Math.max(0, firstTokenDurationMs - Math.min(reasoningDurationMs, firstTokenDurationMs))
      : undefined
  const textGenerationDurationMs =
    waitingFirstTokenDurationMs !== undefined && stats.timeCompletionMs !== undefined
      ? Math.max(0, stats.timeCompletionMs - waitingFirstTokenDurationMs - reasoningDurationMs)
      : undefined
  const createdAt = Date.parse(message.createdAt)
  const createdAtLabel = Number.isFinite(createdAt) ? dateFormatter.format(new Date(createdAt)) : undefined
  const formatTokens = (value: number) =>
    t('chat.message.token_details.tokens', { value: numberFormatter.format(value) })
  const formatPercent = (value: number) => percentageFormatter.format(value)
  const formatMilliseconds = (value: number) => formatDuration(value, decimalFormatter)

  return (
    <div className="text-popover-foreground">
      <header className="flex min-w-0 items-start gap-2.5 p-3">
        {model ? (
          <ModelAvatar
            model={model}
            size={32}
            className="-outline-offset-1 shrink-0 outline outline-1 outline-black/10 dark:outline-white/10"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground text-sm leading-5" title={model?.name}>
            {model?.name ?? model?.id ?? message.modelId}
          </div>
          {providerName ? (
            <div className="truncate text-foreground-secondary text-xs leading-5" title={providerName}>
              {providerName}
            </div>
          ) : null}
          {createdAtLabel ? (
            <time
              dateTime={message.createdAt}
              className="block truncate text-[11px] text-foreground-muted leading-4"
              title={createdAtLabel}>
              {createdAtLabel}
            </time>
          ) : null}
        </div>
      </header>

      <div className="space-y-2 border-border-muted border-t p-3">
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

        {waitingFirstTokenDurationMs !== undefined && textGenerationDurationMs !== undefined ? (
          <InspectableMetricBar
            id="request-duration"
            title={t('chat.message.token_details.request_duration')}
            segments={[
              {
                id: 'waiting-first-token',
                label: t('chat.message.token_details.waiting_first_token'),
                value: waitingFirstTokenDurationMs,
                colorClassName: 'bg-amber-500'
              },
              {
                id: 'reasoning-time',
                label: t('chat.message.token_details.reasoning_time'),
                value: reasoningDurationMs,
                colorClassName: 'bg-fuchsia-500'
              },
              {
                id: 'text-generation',
                label: t('chat.message.token_details.text_generation'),
                value: textGenerationDurationMs,
                colorClassName: 'bg-blue-500'
              }
            ]}
            formatValue={formatMilliseconds}
            formatPercent={formatPercent}
            showAllDetails={showAllDetails}
          />
        ) : null}
      </div>
    </div>
  )
}

export default MessageTokenDetailsCard
