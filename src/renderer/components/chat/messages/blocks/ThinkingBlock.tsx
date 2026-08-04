import { type MarkdownSource } from '@cherrystudio/ui'
import { type CSSProperties, memo, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import ChatMarkdown from '../markdown/ChatMarkdown'
import { useMessageRenderConfig } from '../MessageListProvider'
import ThinkingEffect from './ThinkingEffect'
import { useMinimumDisplayDuration } from './useMinimumDisplayDuration'
import { useScrollAnchor } from './useScrollAnchor'

// This content treatment stays owner-local because the nearest readable shared role shifts it beyond the 90% gate.
const THINKING_MUTED_COLOR = 'color-mix(in oklch, var(--foreground) 44.4444%, transparent)'
const THINKING_SECONDARY_COLOR = 'var(--muted-foreground)'
const CJK_SENTENCE_ENDINGS = '。！？'
const ASCII_SENTENCE_ENDINGS = '.!?'
const THINKING_PREVIEW_MIN_DURATION_MS = 1000

function normalizeThinkingPreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

function getThinkingPreviewKey(preview: string): string {
  return preview
}

function shouldBypassThinkingPreviewStabilization(currentPreview: string): boolean {
  return !currentPreview
}

function getLatestCompletedThinkingPreview(content: string): string {
  let latestCompletedSegment = ''
  let segmentStart = 0

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    const nextCharacter = content[index + 1]
    const isLineEnding = character === '\n' || character === '\r'
    const isFollowingCjkSentenceEnding = nextCharacter !== undefined && CJK_SENTENCE_ENDINGS.includes(nextCharacter)
    const isSentenceEnding =
      (CJK_SENTENCE_ENDINGS.includes(character) && !isFollowingCjkSentenceEnding) ||
      (ASCII_SENTENCE_ENDINGS.includes(character) && (nextCharacter === undefined || /\s/.test(nextCharacter)))

    if (!isLineEnding && !isSentenceEnding) continue

    const segmentEnd = isLineEnding ? index : index + 1
    const completedSegment = normalizeThinkingPreview(content.slice(segmentStart, segmentEnd))
    if (completedSegment) latestCompletedSegment = completedSegment

    if (character === '\r' && nextCharacter === '\n') index += 1
    segmentStart = index + 1
  }

  return latestCompletedSegment
}

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
      className="relative [&_.markdown>p:only-child]:mb-0!"
      style={
        {
          '--markdown-foreground': THINKING_MUTED_COLOR,
          color: THINKING_MUTED_COLOR,
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
  const previewText = useMemo(
    () => (!isThinking && showTitlePreview ? normalizeThinkingPreview(content ?? '') : ''),
    [content, isThinking, showTitlePreview]
  )
  const nextStreamingPreview = useMemo(
    () => (isThinking ? getLatestCompletedThinkingPreview(content ?? '') : ''),
    [content, isThinking]
  )
  const streamingPreviewText = useMinimumDisplayDuration(nextStreamingPreview, {
    enabled: isThinking,
    getKey: getThinkingPreviewKey,
    minimumDurationMs: THINKING_PREVIEW_MIN_DURATION_MS,
    shouldBypass: shouldBypassThinkingPreviewStabilization
  })

  useEffect(() => {
    if (thoughtAutoCollapse) {
      setIsExpanded(false)
    }
  }, [thoughtAutoCollapse])

  if (!content) {
    return null
  }

  return (
    <div
      ref={anchorRef}
      data-ui="part:message-reasoning"
      className="message-thought-container group/thought mb-0.5 max-w-full">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="w-full rounded border-0 bg-transparent p-0 text-left focus-visible:bg-accent/50 focus-visible:outline-none"
        onClick={() =>
          withScrollAnchor(() => setIsExpanded((expanded) => !expanded), { enterReadingMode: !isExpanded })
        }
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            withScrollAnchor(() => setIsExpanded((expanded) => !expanded), { enterReadingMode: !isExpanded })
          }
        }}>
        <ThinkingEffect
          thinkingTimeText={<ThinkingTimeSeconds isThinking={isThinking} />}
          trailing={
            isThinking ? (
              <>
                <span
                  aria-hidden="true"
                  className="flex shrink-0 items-center text-foreground-tertiary"
                  data-testid="thinking-loading-indicator">
                  <BeatLoader color="currentColor" size={4} speedMultiplier={0.8} />
                </span>
                {streamingPreviewText && (
                  <span
                    aria-hidden="true"
                    className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[13px] leading-5"
                    style={{ color: THINKING_MUTED_COLOR }}>
                    {streamingPreviewText}
                  </span>
                )}
              </>
            ) : showTitlePreview && previewText ? (
              <span
                aria-hidden="true"
                className="min-w-0 flex-1 truncate whitespace-nowrap text-[13px] leading-5"
                style={{ color: THINKING_MUTED_COLOR }}>
                {previewText}
              </span>
            ) : null
          }
        />
      </div>
      <div
        id={contentId}
        hidden={!isExpanded}
        className="mt-1.5 max-h-96 overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] leading-5"
        style={{ color: THINKING_SECONDARY_COLOR }}>
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
