import { CheckOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import { MessageBlockStatus, type ThinkingMessageBlock } from '@renderer/types/newMessage'
import { Collapse, message as antdMessage, Tooltip } from 'antd'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BarLoader from 'react-spinners/BarLoader'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'
interface Props {
  block: ThinkingMessageBlock
}

const ThinkingBlock: React.FC<Props> = ({ block }) => {
  const [activeKey, setActiveKey] = useState<'thought' | ''>('thought')
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
  const { messageFont, fontSize, thoughtAutoCollapse } = useSettings()

  const isThinking = useMemo(
    () =>
      block.status === MessageBlockStatus.PROCESSING ||
      block.status === MessageBlockStatus.STREAMING ||
      block.status === MessageBlockStatus.PENDING,
    [block.status]
  )

  const fontFamily = useMemo(() => {
    return messageFont === 'serif'
      ? 'serif'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans","Helvetica Neue", sans-serif'
  }, [messageFont])

  useEffect(() => {
    if (!isThinking && thoughtAutoCollapse) setActiveKey('')
  }, [isThinking, thoughtAutoCollapse])

  const copyThought = useCallback(() => {
    if (block.content) {
      navigator.clipboard.writeText(block.content)
      antdMessage.success({ content: t('message.copied'), key: 'copy-message' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [block.content, t])

  if (!block.content) {
    return null
  }

  const thinkingTime = block.thinking_millsec || 0
  const thinkingTimeSeconds = (thinkingTime / 1000).toFixed(1)

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
                {t(isThinking ? 'chat.thinking' : 'chat.deeply_thought', {
                  secounds: thinkingTimeSeconds
                })}
              </TinkingText>
              {isThinking && <BarLoader color="#9254de" />}
              {!isThinking && (
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
            //  FIXME: 临时兼容
            <div style={{ fontFamily, fontSize }}>
              <Markdown block={block} />
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

export default memo(ThinkingBlock)
