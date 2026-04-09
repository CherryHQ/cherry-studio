import { CheckOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ThinkingEffect from '@renderer/components/ThinkingEffect'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { Collapse } from 'antd'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { MarkdownSource } from '../../Markdown/Markdown'
import Markdown from '../../Markdown/Markdown'

const logger = loggerService.withContext('ThinkingBlock')

interface Props {
  /** Stable ID for heading prefix and block identity tracking */
  id: string
  /** Markdown content to render */
  content: string
  /** Whether this block is currently streaming */
  isStreaming: boolean
  /** Thinking duration in milliseconds */
  thinkingMs: number
}

const ThinkingBlock: React.FC<Props> = ({ id, content, isStreaming, thinkingMs }) => {
  const block = useMemo<MarkdownSource>(
    () => ({
      id,
      content,
      status: isStreaming ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS
    }),
    [id, content, isStreaming]
  )
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const { t } = useTranslation()
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const [thoughtAutoCollapse] = usePreference('chat.message.thought.auto_collapse')
  const [activeKey, setActiveKey] = useState<'thought' | ''>(thoughtAutoCollapse ? '' : 'thought')

  const isThinking = isStreaming

  useEffect(() => {
    if (thoughtAutoCollapse) {
      setActiveKey('')
    } else {
      setActiveKey('thought')
    }
  }, [isThinking, thoughtAutoCollapse])

  const copyThought = useCallback(() => {
    if (content) {
      navigator.clipboard
        .writeText(content)
        .then(() => {
          window.toast.success({ title: t('message.copied'), key: 'copy-message' })
          setCopied(true)
        })
        .catch((error) => {
          logger.error('Failed to copy text:', error)
          window.toast.error({ title: t('message.copy.failed'), key: 'copy-message-error' })
        })
    }
  }, [content, setCopied, t])

  if (!content) {
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
              thinkingTimeText={<ThinkingTimeSeconds blockThinkingTime={thinkingMs} isThinking={isThinking} />}
              content={content}
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
                <Tooltip content={t('common.copy')} delay={800}>
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

const normalizeThinkingTime = (value?: number) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const ThinkingTimeSeconds = memo(
  ({ blockThinkingTime, isThinking }: { blockThinkingTime: number; isThinking: boolean }) => {
    const { t } = useTranslation()
    // Initialize to 0 so the local timer always starts fresh when thinking begins.
    // The actual blockThinkingTime is only applied once thinking completes (isThinking = false),
    // which prevents a race condition from inflating the initial display value.
    const [displayTime, setDisplayTime] = useState(isThinking ? 0 : normalizeThinkingTime(blockThinkingTime))

    const timer = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
      if (isThinking) {
        if (!timer.current) {
          timer.current = setInterval(() => {
            setDisplayTime((prev) => prev + 100)
          }, 100)
        }
      } else {
        if (timer.current) {
          clearInterval(timer.current)
          timer.current = null
        }
        // Only reset to blockThinkingTime if it carries a real value.
        // When blockThinkingTime is 0 (e.g. providerMetadata not yet populated),
        // preserve the locally accumulated timer value instead of resetting to 0.
        const normalized = normalizeThinkingTime(blockThinkingTime)
        if (normalized > 0) {
          setDisplayTime(normalized)
        }
      }

      return () => {
        if (timer.current) {
          clearInterval(timer.current)
          timer.current = null
        }
      }
    }, [isThinking, blockThinkingTime])

    const thinkingTimeSeconds = useMemo(() => {
      const safeTime = normalizeThinkingTime(displayTime)
      return ((safeTime < 1000 ? 100 : safeTime) / 1000).toFixed(1)
    }, [displayTime])

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
