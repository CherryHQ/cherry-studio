import { CheckOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import { MessageBlockStatus, type ThinkingMessageBlock } from '@renderer/types/newMessage'
import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { Collapse, message as antdMessage, Tooltip } from 'antd'
import { ChevronRight, Lightbulb } from 'lucide-react'
import { motion } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

interface Props {
  block: ThinkingMessageBlock
}

const ThinkingBlock: React.FC<Props> = ({ block }) => {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
  const { messageFont, fontSize, thoughtAutoCollapse } = useSettings()
  const [activeKey, setActiveKey] = useState<'thought' | ''>(thoughtAutoCollapse ? '' : 'thought')

  const isThinking = useMemo(() => block.status === MessageBlockStatus.STREAMING, [block.status])

  useEffect(() => {
    if (!isThinking && thoughtAutoCollapse) {
      setActiveKey('')
    } else {
      setActiveKey('thought')
    }
  }, [isThinking, thoughtAutoCollapse])

  const copyThought = useCallback(() => {
    if (block.content) {
      navigator.clipboard
        .writeText(block.content)
        .then(() => {
          antdMessage.success({ content: t('message.copied'), key: 'copy-message' })
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
        .catch((error) => {
          console.error('Failed to copy text:', error)
          antdMessage.error({ content: t('message.copy.failed'), key: 'copy-message-error' })
        })
    }
  }, [block.content, t])

  if (!block.content) {
    return null
  }

  return (
    <CollapseContainer
      activeKey={activeKey}
      size="small"
      onChange={() => setActiveKey((key) => (key ? '' : 'thought'))}
      className="message-thought-container"
      expandIcon={({ isActive }) => (
        <ChevronRight
          color="var(--color-text-3)"
          size={16}
          strokeWidth={1.5}
          style={{ transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
      )}
      expandIconPosition="end"
      items={[
        {
          key: 'thought',
          label: (
            <MessageTitleLabel>
              <motion.span
                style={{ height: '18px' }}
                variants={lightbulbVariants}
                animate={isThinking ? 'active' : 'idle'}
                initial="idle">
                <Lightbulb size={18} />
              </motion.span>
              <ThinkingText>
                <ThinkingTimeSeconds blockThinkingTime={block.thinking_millsec} isThinking={isThinking} />
              </ThinkingText>
              {/* {isThinking && <BarLoader color="#9254de" />} */}
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
            <div
              style={{
                fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
                fontSize
              }}>
              <Markdown block={block} />
            </div>
          )
        }
      ]}
    />
  )
}

const ThinkingTimeSeconds = memo(
  ({ blockThinkingTime, isThinking }: { blockThinkingTime?: number; isThinking: boolean }) => {
    const { t } = useTranslation()

    const [thinkingTime, setThinkingTime] = useState(blockThinkingTime || 0)

    // FIXME: 这里统计的和请求处统计的有一定误差
    useEffect(() => {
      let timer: NodeJS.Timeout | null = null
      if (isThinking) {
        timer = setInterval(() => {
          setThinkingTime((prev) => prev + 100)
        }, 100)
      } else if (timer) {
        // 立即清除计时器
        clearInterval(timer)
        timer = null
      }

      return () => {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }
    }, [isThinking])

    const thinkingTimeSeconds = useMemo(() => (thinkingTime / 1000).toFixed(1), [thinkingTime])

    return t(isThinking ? 'chat.thinking' : 'chat.deeply_thought', {
      seconds: thinkingTimeSeconds
    })
  }
)

const CollapseContainer = styled(Collapse)`
  margin: 15px 0;
`

const MessageTitleLabel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 22px;
  gap: 4px;
`

const ThinkingText = styled.span`
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
