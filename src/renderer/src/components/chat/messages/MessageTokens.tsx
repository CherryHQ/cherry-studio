// import { useRuntime } from '@renderer/hooks/useRuntime'
import { Tooltip } from '@cherrystudio/ui'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { t } from 'i18next'

interface MessageTokensProps {
  message: Message
  isLastMessage?: boolean
}

const MessageTokens: React.FC<MessageTokensProps> = ({ message }) => {
  // const { generating } = useRuntime()
  const locateMessage = () => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
  }

  const getPrice = () => {
    const inputTokens = message?.usage?.prompt_tokens ?? 0
    const outputTokens = message?.usage?.completion_tokens ?? 0
    const model = message.model

    // For OpenRouter, use the cost directly from usage if available
    if (model?.provider === 'openrouter' && message?.usage?.cost !== undefined) {
      return message.usage.cost
    }

    if (!model || model.pricing?.input_per_million_tokens === 0 || model.pricing?.output_per_million_tokens === 0) {
      return 0
    }
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
    const shouldShowCost = message.model?.provider === 'openrouter' || price > 0
    if (!shouldShowCost) {
      return ''
    }
    const currencySymbol = message.model?.pricing?.currencySymbol || '$'
    return `| ${t('models.price.cost')}: ${currencySymbol}${price.toFixed(6)}`
  }

  if (!message.usage) {
    return null
  }

  if (message.role === 'user') {
    return (
      <div
        className="message-tokens cursor-pointer select-text text-right text-(--color-text-3) text-[10px]"
        onClick={locateMessage}>
        {`Tokens: ${message?.usage?.total_tokens}`}
      </div>
    )
  }

  if (message.role === 'assistant') {
    let metrixs = ''
    let hasMetrics = false
    if (message?.metrics?.completion_tokens && message?.metrics?.time_completion_millsec) {
      hasMetrics = true
      metrixs = t('settings.messages.metrics', {
        time_first_token_millsec: message?.metrics?.time_first_token_millsec,
        token_speed: (message?.metrics?.completion_tokens / (message?.metrics?.time_completion_millsec / 1000)).toFixed(
          0
        )
      })
    }

    const tokensInfo = (
      <span className="tokens inline-flex items-center">
        Tokens:
        <span className="px-0.5">{message?.usage?.total_tokens}</span>
        <span className="px-0.5">↑{message?.usage?.prompt_tokens}</span>
        <span className="px-0.5">↓{message?.usage?.completion_tokens}</span>
        <span className="px-0.5">{getPriceString()}</span>
      </span>
    )

    return (
      <div
        className="message-tokens cursor-pointer select-text text-right text-(--color-text-3) text-[10px]"
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
