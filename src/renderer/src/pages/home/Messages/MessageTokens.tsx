// import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { t } from 'i18next'
import styled from 'styled-components'

interface MessageTokensProps {
  message: Message
  isLastMessage?: boolean
}

const MessgeTokens: React.FC<MessageTokensProps> = ({ message }) => {
  // const { generating } = useRuntime()
  const locateMessage = () => {
    EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
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
          Tokens:
          <span>{message?.usage?.total_tokens}</span>
          <span>↑{message?.usage?.prompt_tokens}</span>
          <span>↓{message?.usage?.completion_tokens}</span>
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

    span {
      padding: 0 2px;
    }
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
