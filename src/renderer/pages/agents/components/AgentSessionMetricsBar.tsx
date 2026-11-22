import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import ComposerFloatingCapsule from '@renderer/components/composer/ComposerFloatingCapsule'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { buildAgentSessionMetrics } from '../sessionMetrics'

interface AgentSessionMetricsBarProps {
  messages: readonly CherryUIMessage[]
  partsByMessageId: Readonly<Record<string, readonly CherryMessagePart[]>>
  /** Older history is not loaded yet, so counts and token sums cover only the loaded messages. */
  partial?: boolean
}

export function AgentSessionMetricsBar({ messages, partsByMessageId, partial = false }: AgentSessionMetricsBarProps) {
  const { t, i18n } = useTranslation()
  const [showMetricsBar] = usePreference('agent.session.show_metrics_bar')
  const [expanded, setExpanded] = useState(false)
  const metrics = useMemo(() => buildAgentSessionMetrics(messages, partsByMessageId), [messages, partsByMessageId])

  const compactFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage, { notation: 'compact', maximumFractionDigits: 1 }),
    [i18n.resolvedLanguage]
  )
  const decimalFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }),
    [i18n.resolvedLanguage]
  )
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 0 }),
    [i18n.resolvedLanguage]
  )

  if (!showMetricsBar || messages.length === 0) return null

  const unavailable = t('chat.message.token_details.unavailable')
  // While older history is unloaded the sums are lower bounds, so mark them as such.
  const atLeast = partial ? '≥' : ''
  const formatTokens = (value?: number) =>
    value === undefined ? unavailable : `${atLeast}${compactFormatter.format(value)}`
  const formatFirstToken = (ms?: number) => (ms === undefined ? unavailable : `${decimalFormatter.format(ms / 1000)}s`)
  const formatThroughput = (value?: number) =>
    value === undefined
      ? unavailable
      : t('chat.message.token_details.tokens_per_second_value', { value: decimalFormatter.format(value) })
  const formatCacheHit = (value?: number) => (value === undefined ? unavailable : percentFormatter.format(value))

  const summary = [
    t('agent.session.metrics.turns', { value: `${atLeast}${metrics.turns}` }),
    t('agent.session.metrics.steps', { value: `${atLeast}${metrics.toolSteps}` }),
    t('agent.session.metrics.input', { value: formatTokens(metrics.inputTokens) }),
    t('agent.session.metrics.cache_hit', { value: formatCacheHit(metrics.cacheHitRate) }),
    t('agent.session.metrics.first_token', { value: formatFirstToken(metrics.timeFirstTokenMs) }),
    formatThroughput(metrics.tokensPerSecond)
  ].join(' · ')

  const details = [
    { label: t('chat.message.token_details.output'), value: formatTokens(metrics.outputTokens) },
    { label: t('chat.message.token_details.cache_read'), value: formatTokens(metrics.cacheReadTokens) },
    { label: t('chat.message.token_details.cache_write'), value: formatTokens(metrics.cacheWriteTokens) }
  ]

  return (
    <div
      className="pointer-events-none flex w-full flex-col items-center gap-1 px-4 pb-2"
      data-testid="agent-session-metrics-bar"
      role="region"
      aria-label={t('agent.session.metrics.label')}>
      <ComposerFloatingCapsule className="max-w-full">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded ? t('chat.message.token_details.less_details') : t('chat.message.token_details.more_details')
          }
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 items-center gap-2 tabular-nums">
          <span className="truncate text-muted-foreground">{summary}</span>
          {expanded ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
        </button>
      </ComposerFloatingCapsule>
      {expanded && (
        <ComposerFloatingCapsule className="h-auto flex-wrap gap-x-4 gap-y-1 py-1.5 text-xs tabular-nums">
          {details.map((detail) => (
            <span key={detail.label}>
              <span className="text-muted-foreground">{detail.label} </span>
              {detail.value}
            </span>
          ))}
          <span className="w-full text-muted-foreground">{t('agent.session.metrics.note')}</span>
        </ComposerFloatingCapsule>
      )}
    </div>
  )
}
