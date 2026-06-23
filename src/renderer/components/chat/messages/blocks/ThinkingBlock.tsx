import { type MarkdownSource } from '@cherrystudio/ui'
import { type CSSProperties, memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChatMarkdown from '../markdown/ChatMarkdown'
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
  /** Live estimated reasoning tokens for the current thinking block. */
  thoughtsTokens?: number
  /** Thinking start timestamp in epoch ms */
  startedAt?: number
}

const ThinkingBlock: React.FC<Props> = ({ id, content, isStreaming, thinkingMs, thoughtsTokens, startedAt }) => {
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
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="w-full rounded border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        onClick={() => withScrollAnchor(() => setIsExpanded((expanded) => !expanded))}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            withScrollAnchor(() => setIsExpanded((expanded) => !expanded))
          }
        }}>
        <ThinkingEffect
          expanded={isExpanded}
          isThinking={isThinking}
          thinkingTimeText={
            <ThinkingTimeSeconds
              blockThinkingTime={thinkingMs}
              isThinking={isThinking}
              startedAt={startedAt}
              thoughtsTokens={thoughtsTokens}
            />
          }
        />
      </div>
      <div
        id={contentId}
        hidden={!isExpanded}
        className="mt-1.5 max-h-96 overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] text-foreground-secondary leading-5">
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
          <ChatMarkdown block={block} />
        </div>
      </div>
    </div>
  )
}

const normalizeThinkingTime = (value?: number) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const normalizeThoughtsTokens = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined

const ThinkingTimeSeconds = memo(
  ({
    blockThinkingTime,
    isThinking,
    startedAt,
    thoughtsTokens
  }: {
    blockThinkingTime: number
    isThinking: boolean
    startedAt?: number
    thoughtsTokens?: number
  }) => {
    const { t } = useTranslation()

    const safeStartedAt = typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : undefined

    const [displayTime, setDisplayTime] = useState(() => {
      if (!isThinking) return normalizeThinkingTime(blockThinkingTime)
      if (safeStartedAt !== undefined) {
        return Math.max(0, Date.now() - safeStartedAt)
      }
      return 0
    })

    const timer = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
      if (isThinking) {
        if (safeStartedAt !== undefined) {
          setDisplayTime(Math.max(0, Date.now() - safeStartedAt))
        }
        if (!timer.current) {
          timer.current = setInterval(() => {
            if (safeStartedAt !== undefined) {
              setDisplayTime(Math.max(0, Date.now() - safeStartedAt))
            } else {
              setDisplayTime((prev) => prev + 100)
            }
          }, 100)
        }
      } else {
        if (timer.current) {
          clearInterval(timer.current)
          timer.current = null
        }
        const normalized = normalizeThinkingTime(blockThinkingTime)
        setDisplayTime(normalized)
      }

      return () => {
        if (timer.current) {
          clearInterval(timer.current)
          timer.current = null
        }
      }
    }, [isThinking, blockThinkingTime, safeStartedAt])

    const thinkingTimeSeconds = useMemo(() => {
      const safeTime = normalizeThinkingTime(displayTime)
      return ((safeTime < 100 ? 100 : safeTime) / 1000).toFixed(1)
    }, [displayTime])

    const statusText =
      !isThinking && normalizeThinkingTime(blockThinkingTime) <= 0
        ? t('common.reasoning_content')
        : isThinking
          ? t('chat.thinking', {
              seconds: thinkingTimeSeconds
            })
          : t('chat.deeply_thought', {
              seconds: thinkingTimeSeconds
            })

    const normalizedTokens = normalizeThoughtsTokens(thoughtsTokens)
    if (!normalizedTokens) return statusText

    return `${statusText} · ${t('chat.thinking_tokens', {
      tokens: new Intl.NumberFormat().format(normalizedTokens)
    })}`
  }
)

export default memo(ThinkingBlock)
