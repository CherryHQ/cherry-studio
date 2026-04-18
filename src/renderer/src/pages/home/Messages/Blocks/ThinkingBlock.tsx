import { CheckOutlined } from '@ant-design/icons'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MarkdownSource } from '../../Markdown/Markdown'
import Markdown from '../../Markdown/Markdown'
import ThinkingEffect from './ThinkingEffect'
import { useScrollAnchor } from './useScrollAnchor'

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
  const [activeKey, setActiveKey] = useState<string>(thoughtAutoCollapse ? '' : 'thought')
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

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
    <Accordion
      ref={anchorRef}
      type="single"
      collapsible
      value={activeKey}
      onValueChange={(value) => withScrollAnchor(() => setActiveKey(value))}
      className="message-thought-container mb-3.75">
      <AccordionItem value="thought" className="border-0 first:border-t-0">
        <AccordionTrigger className="p-0 hover:no-underline [&>svg]:hidden">
          <ThinkingEffect
            expanded={activeKey === 'thought'}
            isThinking={isThinking}
            thinkingTimeText={<ThinkingTimeSeconds blockThinkingTime={thinkingMs} isThinking={isThinking} />}
            content={content}
          />
        </AccordionTrigger>
        <AccordionContent className="rounded-b-xl border-(--color-border) border-x-[0.5px] border-b-[0.5px] border-solid px-4 pt-4 pb-4">
          {/* FIXME: 临时兼容 */}
          <div
            className="relative"
            style={{
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize
            }}>
            {!isThinking && (
              <Tooltip content={t('common.copy')} delay={800}>
                <button
                  className="message-action-button -right-3 -top-3 absolute ml-auto flex cursor-pointer items-center justify-center border-none bg-transparent p-1 text-(--color-text-2) opacity-60 transition-all duration-300 hover:text-(--color-text) hover:opacity-100 focus-visible:outline-(--color-primary) focus-visible:outline-2 focus-visible:outline-offset-2 [&_.iconfont]:text-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyThought()
                  }}
                  aria-label={t('common.copy')}>
                  {!copied && <i className="iconfont icon-copy"></i>}
                  {copied && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
                </button>
              </Tooltip>
            )}
            <Markdown block={block} />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

const normalizeThinkingTime = (value?: number) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const ThinkingTimeSeconds = memo(
  ({ blockThinkingTime, isThinking }: { blockThinkingTime: number; isThinking: boolean }) => {
    const { t } = useTranslation()
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

export default memo(ThinkingBlock)
