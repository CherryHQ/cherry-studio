// import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { BarChart3 } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'

import { MessageActionButton } from './MessageActionButton'

interface MessageMetricsButtonProps {
  message: Message
}

const MessageMetricsButton: React.FC<MessageMetricsButtonProps> = ({ message }) => {
  const { showTokens } = useSettings()
  // const { generating } = useRuntime()
  const locateMessage = useCallback(() => {
    EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
  }, [message.id])

  const tooltipContent = useMemo(() => {
    if (!message.usage) return null

    if (message.role === 'user') {
      return <span>Tokens: {message.usage.total_tokens}</span>
    }

    if (message.role === 'assistant') {
      const tokensInfo = {
        name: 'Tokens',
        value: `${message.usage.total_tokens} ↑${message.usage.prompt_tokens} ↓${message.usage.completion_tokens}`
      }

      const throughput =
        message?.metrics?.completion_tokens && message?.metrics?.time_completion_millsec
          ? (message?.metrics?.completion_tokens / (message?.metrics?.time_completion_millsec / 1000)).toFixed(0)
          : null

      const firstTokenDelay = message?.metrics?.time_first_token_millsec
        ? formatElapsedTime(message?.metrics?.time_first_token_millsec)
        : null

      const completionTime = message?.metrics?.time_completion_millsec
        ? formatElapsedTime(message?.metrics?.time_completion_millsec)
        : null

      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '6px 12px',
            alignItems: 'center'
          }}>
          <span>{tokensInfo.name}:</span>
          <span>{tokensInfo.value}</span>

          {throughput && (
            <>
              <span>{t('settings.messages.metrics.throughput')}:</span>
              <span>{throughput} tokens/s</span>
            </>
          )}

          {firstTokenDelay && (
            <>
              <span>{t('settings.messages.metrics.time_to_first_token')}:</span>
              <span>{firstTokenDelay}</span>
            </>
          )}

          {completionTime && (
            <>
              <span>{t('settings.messages.metrics.completion_time')}:</span>
              <span>{completionTime}</span>
            </>
          )}
        </div>
      )
    }

    return null
  }, [message.usage, message.metrics, message.role])

  if (!message.usage || !showTokens || !tooltipContent) {
    return null
  }

  return (
    <Tooltip overlay={tooltipContent} placement="top" mouseEnterDelay={0.5}>
      <MessageActionButton className="message-metrics-button" onClick={locateMessage}>
        <BarChart3 size={16} />
      </MessageActionButton>
    </Tooltip>
  )
}

const formatElapsedTime = (elapsedTime: number) => {
  if (elapsedTime < 1000) {
    return `${elapsedTime} ms`
  } else {
    return `${(elapsedTime / 1000).toFixed(2)} s`
  }
}

export default memo(MessageMetricsButton)
