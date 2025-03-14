import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Message } from '@renderer/types'
import { t } from 'i18next'
import styled from 'styled-components'

const MessgeTokens: React.FC<{ message: Message; isLastMessage: boolean }> = ({ message, isLastMessage }) => {
  const { generating } = useRuntime()

  const locateMessage = () => {
    EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
  }

  const getPrice = () => {
    const inputTokens = message?.usage?.prompt_tokens ?? 0
    const outputTokens = message?.usage?.completion_tokens ?? 0
    const model = message.model
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
    const currencySymbol = message.model?.pricing?.currencySymbol || '$'
    return `| ${t('models.price.cost')}: ${currencySymbol}${price}`
  }

  if (!message.usage) {
    return <div />
  }

  if (message.role === 'user') {
    return (
      <MessageMetadata className="message-tokens" onClick={locateMessage}>
        Tokens: {message?.usage?.total_tokens}
      </MessageMetadata>
    )
  }

  if (isLastMessage && generating) {
    return <div />
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

    return (
      <MessageMetadata className={`message-tokens ${hasMetrics ? 'has-metrics' : ''}`} onClick={locateMessage}>
        <span className="metrics">{metrixs}</span>
        <span className="tokens">
          Tokens: {message?.usage?.total_tokens} ↑{message?.usage?.prompt_tokens} ↓{message?.usage?.completion_tokens}{' '}
          {getPriceString()}
        </span>
      </MessageMetadata>
    )
  }

  return null
}

const MessageMetadata = styled.div`
  font-size: 11px;
  color: var(--color-text-2);
  user-select: text;
  margin: 2px 0;
  cursor: pointer;
  text-align: right;

  .metrics {
    display: none;
  }

  .tokens {
    display: block;
  }

  &.has-metrics:hover {
    .metrics {
      display: block;
    }

    .tokens {
      display: none;
    }
  }
`

export default MessgeTokens
