import { type MarkdownSource } from '@cherrystudio/ui'
import { memo, useEffect, useId, useMemo, useState } from 'react'
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
  /** Whether to expose a one-line content preview in the title row */
  showTitlePreview?: boolean
}

interface ThinkingBlockContentProps {
  id: string
  content: string
  isStreaming: boolean
}

export const ThinkingBlockContent = memo(({ id, content, isStreaming }: ThinkingBlockContentProps) => {
  const block = useMemo<MarkdownSource>(
    () => ({
      id,
      content,
      status: isStreaming ? 'streaming' : 'success'
    }),
    [id, content, isStreaming]
  )
  const { messageFont, fontSize } = useMessageRenderConfig()

  if (!content) return null

  return (
    <div
      className="relative text-foreground-muted [&_.markdown>p:only-child]:mb-0!"
      style={
        {
          '--cs-text-primary': 'var(--color-foreground-muted)',
          '--cs-text-light': 'var(--color-foreground-muted)',
          fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
          fontSize
        } as CSSProperties
      }>
      <ChatMarkdown block={block} />
    </div>
  )
})
ThinkingBlockContent.displayName = 'ThinkingBlockContent'

const ThinkingBlock: React.FC<Props> = ({ id, content, isStreaming, showTitlePreview = false }) => {
  const { thoughtAutoCollapse } = useMessageRenderConfig()
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

  const isThinking = isStreaming
  const previewText = useMemo(() => (content ?? '').replace(/\s+/g, ' ').trim(), [content])

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
          thinkingTimeText={<ThinkingTimeSeconds isThinking={isThinking} />}
          trailing={
            showTitlePreview && previewText ? (
              <span
                aria-hidden="true"
                className="min-w-0 flex-1 truncate whitespace-nowrap text-[13px] text-foreground-muted leading-5">
                {previewText}
              </span>
            ) : null
          }
        />
      </div>
      <div
        id={contentId}
        hidden={!isExpanded}
        className="mt-1.5 max-h-96 overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] text-foreground-secondary leading-5">
        <ThinkingBlockContent id={id} content={content} isStreaming={isStreaming} />
      </div>
    </div>
  )
}

const ThinkingTimeSeconds = memo(({ isThinking }: { isThinking: boolean }) => {
  const { t } = useTranslation()

  if (isThinking) return t('message.tools.placeholder.thinking')
  return t('common.reasoning_content')
})

export default memo(ThinkingBlock)
