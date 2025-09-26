import { CheckOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import ThinkingEffect from '@renderer/components/ThinkingEffect'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { MessageBlockStatus, type ThinkingMessageBlock } from '@renderer/types/newMessage'
import { Collapse, message as antdMessage, Tooltip } from 'antd'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

const logger = loggerService.withContext('ThinkingBlock')
interface Props {
  block: ThinkingMessageBlock
}

const ThinkingBlock: React.FC<Props> = ({ block }) => {
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const { t } = useTranslation()
  const { messageFont, fontSize, thoughtAutoCollapse } = useSettings()
  const [activeKey, setActiveKey] = useState<'thought' | ''>(thoughtAutoCollapse ? '' : 'thought')

  const isThinking = useMemo(() => block.status === MessageBlockStatus.STREAMING, [block.status])

  useEffect(() => {
    if (thoughtAutoCollapse) {
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
        })
        .catch((error) => {
          logger.error('Failed to copy text:', error)
          antdMessage.error({ content: t('message.copy.failed'), key: 'copy-message-error' })
        })
    }
  }, [block.content, setCopied, t])

  if (!block.content) {
    return null
  }

  return (
    <CollapseContainer
      activeKey={activeKey}
      size="small"
      onChange={() => setActiveKey((key) => (key ? '' : 'thought'))}
      className="message-thought-container"
      ghost
      items={[
        {
          key: 'thought',
          label: (
            <ThinkingEffect
              expanded={activeKey === 'thought'}
              isThinking={isThinking}
              thinkingTimeText={
                <ThinkingTimeSeconds blockThinkingTime={block.thinking_millsec} isThinking={isThinking} />
              }
              content={block.content}
            />
          ),
          children: (
            //  FIXME: 临时兼容
            <ThinkingContent
              style={{
                fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
                fontSize
              }}>
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
              <Markdown block={block} />
            </ThinkingContent>
          ),
          showArrow: false
        }
      ]}
    />
  )
}

const ThinkingTimeSeconds = memo(
  ({ blockThinkingTime, isThinking }: { blockThinkingTime: number; isThinking: boolean }) => {
    const { t } = useTranslation()
    const [displayTime, setDisplayTime] = useState(0)
    const animationRef = useRef<NodeJS.Timeout | null>(null)
    const targetTimeRef = useRef(0)
    const currentTimeRef = useRef(0)

    useEffect(() => {
      // 更新目标时间
      targetTimeRef.current = blockThinkingTime
      // 如果不在思考状态，直接设置为目标时间
      if (!isThinking) {
        setDisplayTime(blockThinkingTime)
        currentTimeRef.current = blockThinkingTime
        if (animationRef.current) {
          clearInterval(animationRef.current)
          animationRef.current = null
        }
        return
      }

      // 如果当前时间已经达到或超过目标时间，直接设置
      if (currentTimeRef.current >= blockThinkingTime) {
        setDisplayTime(blockThinkingTime)
        currentTimeRef.current = blockThinkingTime
        return
      }

      // 清除之前的动画
      if (animationRef.current) {
        clearInterval(animationRef.current)
        animationRef.current = null
      }

      // 如果时间差很小，直接设置到目标时间
      const timeDiff = blockThinkingTime - currentTimeRef.current
      if (timeDiff <= 100) {
        setDisplayTime(blockThinkingTime)
        currentTimeRef.current = blockThinkingTime
        return
      }

      // 立即执行一次更新，避免显示0
      const firstIncrement = Math.min(100, blockThinkingTime - currentTimeRef.current)
      currentTimeRef.current += firstIncrement

      setDisplayTime(currentTimeRef.current)

      // 如果已经达到目标，不需要启动定时器
      if (currentTimeRef.current >= targetTimeRef.current) {
        return
      }

      // 启动新的平滑动画
      animationRef.current = setInterval(() => {
        // 每次增加100ms（0.1秒）
        const increment = 100
        const newTime = Math.min(currentTimeRef.current + increment, targetTimeRef.current)

        currentTimeRef.current = newTime
        setDisplayTime(newTime)

        // 如果达到目标时间，停止动画
        if (newTime >= targetTimeRef.current) {
          if (animationRef.current) {
            clearInterval(animationRef.current)
            animationRef.current = null
          }
        }
      }, 100) // 每100ms更新一次

      return () => {
        // 清理时确保显示最终时间
        if (animationRef.current) {
          clearInterval(animationRef.current)
          animationRef.current = null
          // 如果在思考状态被中断，确保显示当前的目标时间
          if (targetTimeRef.current > currentTimeRef.current) {
            setDisplayTime(targetTimeRef.current)
            currentTimeRef.current = targetTimeRef.current
          }
        }
      }
    }, [blockThinkingTime, isThinking])
    const thinkingTimeSeconds = useMemo(() => (displayTime / 1000).toFixed(1), [displayTime])

    return isThinking
      ? t('chat.thinking', {
          seconds: thinkingTimeSeconds
        })
      : t('chat.deeply_thought', {
          seconds: thinkingTimeSeconds
        })
  }
)

const CollapseContainer = styled(Collapse)`
  margin-bottom: 15px;
  .ant-collapse-header {
    padding: 0 !important;
  }
  .ant-collapse-content-box {
    padding: 16px !important;
    border-width: 0 0.5px 0.5px 0.5px;
    border-style: solid;
    border-color: var(--color-border);
    border-radius: 0 0 12px 12px;
  }
`

const ThinkingContent = styled.div`
  position: relative;
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
  position: absolute;
  right: -12px;
  top: -12px;

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
