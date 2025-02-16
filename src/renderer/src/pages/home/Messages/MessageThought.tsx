import { Message } from '@renderer/types'
import { Collapse } from 'antd'
import { FC, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BarLoader from 'react-spinners/BarLoader'
import styled from 'styled-components'
import Markdown from '../Markdown/Markdown'
import { useSettings } from '@renderer/hooks/useSettings'

interface Props {
  message: Message
}

const MessageThought: FC<Props> = ({ message }) => {
  const [activeKey, setActiveKey] = useState<'thought' | ''>('thought')
  const isThinking = !message.content
  const { t } = useTranslation()
  const { messageFont, fontSize } = useSettings()
  const fontFamily = useMemo(() => {
    return messageFont === 'serif'
      ? 'serif'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans","Helvetica Neue", sans-serif'
  }, [messageFont])

  useEffect(() => {
    if (!isThinking) setActiveKey('')
  }, [isThinking])

  if (!message.reasoning_content) {
    return null
  }

  const thinkingTime = message.metrics?.time_thinking_millsec || 0
  const thinkingTimeSeconds = (thinkingTime / 1000).toFixed(1)

  return (
    <CollapseContainer
      activeKey={activeKey}
      onChange={() => setActiveKey((key) => (key ? '' : 'thought'))}
      className="message-thought-container"
      items={[
        {
          key: 'thought',
          label: (
            <MessageTitleLabel>
              <TinkingText>
                {isThinking ? t('chat.thinking') : t('chat.deeply_thought', { secounds: thinkingTimeSeconds })}
              </TinkingText>
              {isThinking && <BarLoader color="#9254de" />}
            </MessageTitleLabel>
          ),
          children: (
            <div style={{ fontFamily, fontSize }}>
              <Markdown message={{ ...message, content: message.reasoning_content }} />
            </div>
          )
        }
      ]}
    />
  )
}

const CollapseContainer = styled(Collapse)`
  margin-bottom: 15px;
`

const MessageTitleLabel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 22px;
  gap: 15px;
`

const TinkingText = styled.span`
  color: var(--color-text-2);
`

export default MessageThought
