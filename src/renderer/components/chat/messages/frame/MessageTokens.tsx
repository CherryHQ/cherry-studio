// import { useRuntime } from '@renderer/hooks/useRuntime'
import { Tooltip } from '@cherrystudio/ui'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import { t } from 'i18next'
import { useMemo } from 'react'

import { useMessageListActions } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'

interface MessageTokensProps {
  message: MessageListItem
  isLastMessage?: boolean
}

const formatTokenCountK = (tokens: number): string => `${(tokens / 1000).toFixed(1)}K`

const MessageTokens: React.FC<MessageTokensProps> = ({ message }) => {
  // const { generating } = useRuntime()
  const actions = useMessageListActions()
  const locateMessage = () => {
    actions.locateMessage?.(message.id, false)
  }
  const usage = useMemo(() => (message.stats ? statsToUsage(message.stats) : undefined), [message.stats])
  const metrics = useMemo(() => (message.stats ? statsToMetrics(message.stats) : undefined), [message.stats])
  const model = useMemo(() => getMessageListItemModel(message), [message])

  const getPrice = () => {
    const inputTokens = usage?.prompt_tokens ?? 0
    const outputTokens = usage?.completion_tokens ?? 0

    // For OpenRouter, use the cost directly from usage if available
    if (model?.provider === 'openrouter' && usage?.cost !== undefined) {
      return usage.cost
    }

    if (!model) {
      return 0
    }
    // Compute each side independently — a model can be free on one side and
    // priced on the other; the sum already contributes 0 for a free side.
    return (
      (inputTokens * (model.pricing?.input_per_million_tokens ?? 0) +
        outputTokens * (model.pricing?.output_per_million_tokens ?? 0)) /
      1000000
    )
  }

  const getPriceString = () => {
    const price = getPrice()
    if (price === 0) {
      return ''
    }
    // For OpenRouter, always show cost even without pricing config
    const shouldShowCost = model?.provider === 'openrouter' || price > 0
    if (!shouldShowCost) {
      return ''
    }
    const currencySymbol = model?.pricing?.currencySymbol || '$'
    return `| ${t('models.price.cost')}: ${currencySymbol}${price.toFixed(6)}`
  }

  if (!usage) {
    return null
  }

  if (message.role === 'user') {
    return (
      <div
        className="message-tokens cursor-pointer select-text text-right text-[10px] text-foreground-muted"
        onClick={locateMessage}>
        {`Tokens: ${formatTokenCountK(usage.total_tokens)}`}
      </div>
    )
  }

  if (message.role === 'assistant') {
    let metrixs = ''
    let hasMetrics = false
    if (metrics?.completion_tokens && metrics?.time_completion_millsec) {
      hasMetrics = true
      // Exclude TTFT from the denominator so the tooltip reports generation
      // throughput, not wall-clock throughput.
      const totalMs = metrics.time_completion_millsec
      const ttftMs = metrics.time_first_token_millsec
      metrixs = t('settings.messages.metrics', {
        time_first_token_millsec: ttftMs,
        token_speed: (metrics.completion_tokens / (totalMs / 1000)).toFixed(0)
      })
    }

    const tokensInfo = (
      <span className="tokens inline-flex items-center">
        Tokens:
        <span className="px-0.5">{formatTokenCountK(usage.total_tokens)}</span>
        <span className="px-0.5">↑{formatTokenCountK(usage.prompt_tokens)}</span>
        <span className="px-0.5">↓{formatTokenCountK(usage.completion_tokens)}</span>
        <span className="px-0.5">{getPriceString()}</span>
      </span>
    )

    return (
      <div
        className="message-tokens cursor-pointer select-text text-right text-[10px] text-foreground-muted"
        onClick={locateMessage}>
        {hasMetrics ? (
          <Tooltip content={metrixs} placement="top" classNames={{ content: 'text-[11px]' }}>
            {tokensInfo}
          </Tooltip>
        ) : (
          tokensInfo
        )}
      </div>
    )
  }

  return null
}

export default MessageTokens
