import { type CSSProperties, memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MarkdownSource } from '../markdown/Markdown'
import Markdown from '../markdown/Markdown'
import { useMessageRenderConfig } from '../MessageListProvider'
import ThinkingEffect from './ThinkingEffect'
import { useScrollAnchor } from './useScrollAnchor'

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
  const { messageFont, fontSize, thoughtAutoCollapse } = useMessageRenderConfig()
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

  const isThinking = isStreaming

  useEffect(() => {
    if (thoughtAutoCollapse) {
      setIsExpanded(false)
    }
  }, [thoughtAutoCollapse])

  if (!content) {
    return null
  }

  return (
    <div ref={anchorRef} className="message-thought-container group/thought mb-0.5 max-w-full">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="w-full rounded border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        onClick={() => withScrollAnchor(() => setIsExpanded((expanded) => !expanded))}>
        <ThinkingEffect
          expanded={isExpanded}
          isThinking={isThinking}
          thinkingTimeText={<ThinkingTimeSeconds blockThinkingTime={thinkingMs} isThinking={isThinking} />}
        />
      </button>
      <div id={contentId} hidden={!isExpanded} className="mt-1">
        <div
          className="relative text-foreground-muted [&_.markdown>p:only-child]:mb-0!"
          style={
            {
              '--color-text': 'var(--color-foreground-muted)',
              '--color-text-light': 'var(--color-foreground-muted)',
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize
            } as CSSProperties
          }>
          <Markdown block={block} />
        </div>
      </div>
    </div>
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
