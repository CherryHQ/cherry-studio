import { CheckOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import { Message } from '@renderer/types'
import { Collapse, message as antdMessage, Tooltip } from 'antd'
import { FC, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BarLoader from 'react-spinners/BarLoader'
import styled from 'styled-components'

import Markdown from '../Markdown/Markdown'

interface Props {
  message: Message
}

const MessageThought: FC<Props> = ({ message }) => {
  const [activeKey, setActiveKey] = useState<'thought' | ''>('thought')
  const [copied, setCopied] = useState(false)
  const isThinking = !message.content
  const { t } = useTranslation()
  const { messageFont, fontSize, thoughtAutoCollapse } = useSettings()
  const fontFamily = useMemo(() => {
    return messageFont === 'serif'
      ? 'serif'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans","Helvetica Neue", sans-serif'
  }, [messageFont])

  useEffect(() => {
    if (!isThinking && thoughtAutoCollapse) setActiveKey('')
  }, [isThinking, thoughtAutoCollapse])

  if (!message.reasoning_content) {
    return null
  }

  // 清理思考内容中可能包含的用户查询信息
  const cleanReasoningContent = (() => {
    if (!message.reasoning_content) return ''

    // 移除可能的用户查询前缀
    let content = message.reasoning_content

    // 检查并移除类似"The user has responded with..."的前缀
    const userQueryPattern = /^The user has responded with.*?\n/
    content = content.replace(userQueryPattern, '')

    // 检查并移除类似"<user_query>..."的部分
    const userQueryTagPattern = /<user_query>[\s\S]*?<\/user_query>/g
    content = content.replace(userQueryTagPattern, '')

    // 移除开头的多余空行
    content = content.replace(/^\s+/, '')

    return content
  })()

  const copyThought = () => {
    if (cleanReasoningContent) {
      navigator.clipboard.writeText(cleanReasoningContent)
      antdMessage.success({ content: t('message.copied'), key: 'copy-message' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const thinkingTime = message.metrics?.time_thinking_millsec || 0
  const thinkingTimeSeconds = (thinkingTime / 1000).toFixed(1)
  const isPaused = message.status === 'paused'

  return (
    <CollapseContainer
      activeKey={activeKey}
      size="small"
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
              {isThinking && !isPaused && <BarLoader color="#9254de" />}
              {(!isThinking || isPaused) && (
                <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
                  <ActionButton
                    className="message-action-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyThought()
                    }}
                    aria-label={t('common.copy')}>
                    {!copied && <i className="iconfont icon-copy"></i>}
                    {copied && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
                  </ActionButton>
                </Tooltip>
              )}
            </MessageTitleLabel>
          ),
          children: (
            <div style={{ fontFamily, fontSize }}>
              <Markdown message={{ ...message, content: cleanReasoningContent }} />
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

const ActionButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-2);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  opacity: 0.6;
  transition: all 0.3s;

  &:hover {
    opacity: 1;
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .iconfont {
    font-size: 14px;
  }
`

export default MessageThought
