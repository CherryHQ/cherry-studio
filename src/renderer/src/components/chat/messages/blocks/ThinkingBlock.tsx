import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CopyIcon } from '@renderer/components/Icons'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { Check } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MarkdownSource } from '../markdown/Markdown'
import Markdown from '../markdown/Markdown'
import { useMessageListActions, useMessageRenderConfig } from '../MessageListProvider'
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
      status: isStreaming ? 'streaming' : 'success'
    }),
    [id, content, isStreaming]
  )
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const { t } = useTranslation()
  const { copyText, notifyError } = useMessageListActions()
  const { messageFont, fontSize, thoughtAutoCollapse } = useMessageRenderConfig()
  const [activeKey, setActiveKey] = useState<string>('')
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

  const isThinking = isStreaming

  useEffect(() => {
    if (thoughtAutoCollapse) {
      setActiveKey('')
    }
  }, [thoughtAutoCollapse])

  const copyThought = useCallback(() => {
    if (!content || !copyText) return
    Promise.resolve(copyText(content, { successMessage: t('message.copied') }))
      .then(() => setCopied(true))
      .catch((error) => {
        logger.error('Failed to copy text:', error)
        notifyError?.(t('message.copy.failed'))
      })
  }, [content, copyText, notifyError, setCopied, t])

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
      className="message-thought-container group/thought mb-0.5">
      <AccordionItem value="thought" className="border-0 first:border-t-0">
        <AccordionTrigger className="p-0 hover:no-underline [&>svg]:hidden">
          <ThinkingEffect
            expanded={activeKey === 'thought'}
            isThinking={isThinking}
            thinkingTimeText={<ThinkingTimeSeconds blockThinkingTime={thinkingMs} isThinking={isThinking} />}
            copyButton={
              !isThinking && copyText ? (
                <Tooltip content={t('common.copy')} delay={800}>
                  <button
                    type="button"
                    className="message-action-button flex size-5 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-foreground-secondary transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyThought()
                    }}
                    aria-label={t('common.copy')}>
                    {!copied && <CopyIcon size={13} />}
                    {copied && <Check size={13} color="var(--color-primary)" />}
                  </button>
                </Tooltip>
              ) : undefined
            }
          />
        </AccordionTrigger>
        <AccordionContent className="ml-2 border-border border-l pt-0.5 pr-0 pb-1 pl-6.5">
          <div
            className="relative [&_.markdown>p:only-child]:mb-0!"
            style={{
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize
            }}>
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
