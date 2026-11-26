import { type CSSProperties, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import { type MarkdownSource, ScrollArea } from '@cherrystudio/ui'
import { useProjectionPart } from '@renderer/hooks/agent/useProjectionPart'
import type { CherryMessagePart } from '@shared/data/types/message'

import { useMessageDisclosureState } from '../hooks/useMessageDisclosureState'
import { getDistanceToBottom, getRealBottom } from '../list/scrollGeometry'
import { VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX } from '../list/ScrollOwnershipContext'
import ChatMarkdown from '../markdown/ChatMarkdown'
import { useMessageRenderConfig } from '../MessageListProvider'
import ThinkingEffect from './ThinkingEffect'
import { normalizeThinkingPreview, scanThinkingPreview, type ThinkingPreviewScanState } from './thinkingPreview'
import { useMinimumDisplayDuration } from './useMinimumDisplayDuration'
import { useScrollAnchor } from './useScrollAnchor'

const THINKING_PREVIEW_MIN_DURATION_MS = 1000
const THINKING_CONTENT_PANEL_BASE_CLASSNAME = 'mt-1.5 rounded-xl bg-muted text-[13px] leading-5 text-muted-foreground'
const THINKING_CONTENT_PANEL_CAPPED_CLASSNAME = `${THINKING_CONTENT_PANEL_BASE_CLASSNAME} max-h-[min(32rem,60dvh)] overflow-auto`

function getThinkingPreviewKey(preview: string): string {
  return preview
}

function shouldBypassThinkingPreviewStabilization(currentPreview: string): boolean {
  return !currentPreview
}

interface Props {
  /** Stable ID for heading prefix and block identity tracking */
  id: string
  /** Markdown content to render */
  content: string
  livePart?: CherryMessagePart
  /** Whether this block is currently streaming */
  isStreaming: boolean
  /** Whether to expose a one-line content preview in the title row */
  showTitlePreview?: boolean
}

interface ThinkingBlockContentProps {
  id: string
  content: string
  livePart?: CherryMessagePart
  isStreaming: boolean
}

export const ThinkingBlockContent = memo(
  ({ id, content: initialContent, livePart, isStreaming: initiallyStreaming }: ThinkingBlockContentProps) => {
    const part = useProjectionPart(id, livePart)
    const isStreaming = initiallyStreaming && (part?.type !== 'reasoning' || part.state === 'streaming')
    const content = part?.type === 'reasoning' ? part.text : initialContent
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
        className="relative text-muted-foreground [&_.markdown>p:only-child]:mb-0!"
        style={
          {
            '--markdown-foreground': 'var(--muted-foreground)',
            fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
            fontSize
          } as CSSProperties
        }>
        <ChatMarkdown block={block} />
      </div>
    )
  }
)
ThinkingBlockContent.displayName = 'ThinkingBlockContent'

const ThinkingBlock: React.FC<Props> = ({
  id,
  content: initialContent,
  livePart,
  isStreaming: initiallyStreaming,
  showTitlePreview = false
}) => {
  const part = useProjectionPart(id, livePart)
  const isStreaming = initiallyStreaming && (part?.type !== 'reasoning' || part.state === 'streaming')
  const content = part?.type === 'reasoning' ? part.text : initialContent
  const { thoughtAutoCollapse } = useMessageRenderConfig()
  const [isExpanded, setIsExpanded] = useMessageDisclosureState(`reasoning:${id}`, !thoughtAutoCollapse)
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const [previousThoughtAutoCollapse, setPreviousThoughtAutoCollapse] = useMessageDisclosureState(
    `reasoning-preference:${id}`,
    thoughtAutoCollapse
  )
  // Tracks whether the user explicitly toggled this block in the current mount.
  // While streaming the block auto-expands (effectiveExpanded) without writing
  // to the disclosure cache, so a live `true` never leaks into the completed
  // mount. After streaming ends the view falls back to the cached preference
  // default (collapsed when auto-collapse is on).
  const [hasManualOverride, setHasManualOverride] = useState(false)
  const hasContent = !!content

  // A new reasoning part starts without a manual override.
  useEffect(() => {
    setHasManualOverride(false)
  }, [id])

  // While streaming, show the thinking expanded so the live run stays followable,
  // unless the user explicitly collapsed it in this mount. After streaming ends,
  // fall back to the cached disclosure (collapsed by default when auto-collapse
  // is on), which is what auto-collapses Agent thinking into the summary bar.
  const effectiveExpanded = isStreaming && !hasManualOverride ? true : isExpanded

  const toggleExpanded = useCallback(() => {
    const next = !effectiveExpanded
    setHasManualOverride(true)
    setIsExpanded(next)
  }, [effectiveExpanded, setIsExpanded])

  useEffect(() => {
    const panel = contentRef.current
    if (!panel || !effectiveExpanded || !isStreaming) return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) panel.scrollTop = getRealBottom(panel)
    })
    observer.observe(panel)
    if (panel.firstElementChild) observer.observe(panel.firstElementChild)
    return () => observer.disconnect()
  }, [hasContent, effectiveExpanded, isStreaming])
  const thinkingPreviewScanStateRef = useRef<ThinkingPreviewScanState | undefined>(undefined)
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

  const isThinking = isStreaming
  const previewText = useMemo(
    () => (!isThinking && showTitlePreview ? normalizeThinkingPreview(content ?? '') : ''),
    [content, isThinking, showTitlePreview]
  )
  const thinkingPreviewScanResult = useMemo(
    () => (isThinking ? scanThinkingPreview(content ?? '', thinkingPreviewScanStateRef.current) : undefined),
    [content, isThinking]
  )
  const nextStreamingPreview = thinkingPreviewScanResult?.preview ?? ''
  const streamingPreviewText = useMinimumDisplayDuration(nextStreamingPreview, {
    enabled: isThinking,
    getKey: getThinkingPreviewKey,
    minimumDurationMs: THINKING_PREVIEW_MIN_DURATION_MS,
    shouldBypass: shouldBypassThinkingPreviewStabilization
  })

  useEffect(() => {
    thinkingPreviewScanStateRef.current = thinkingPreviewScanResult?.state
  }, [thinkingPreviewScanResult])

  useEffect(() => {
    if (previousThoughtAutoCollapse !== thoughtAutoCollapse) {
      setIsExpanded(!thoughtAutoCollapse)
      setHasManualOverride(false)
    }
    setPreviousThoughtAutoCollapse(thoughtAutoCollapse)
  }, [previousThoughtAutoCollapse, setIsExpanded, setPreviousThoughtAutoCollapse, thoughtAutoCollapse])

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
        aria-expanded={effectiveExpanded}
        aria-controls={contentId}
        className="w-full rounded border-0 bg-transparent p-0 text-left focus-visible:bg-accent/50 focus-visible:outline-none"
        onClick={() => withScrollAnchor(toggleExpanded, { enterReadingMode: !effectiveExpanded })}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            withScrollAnchor(toggleExpanded, { enterReadingMode: !effectiveExpanded })
          }
        }}>
        <ThinkingEffect
          thinkingTimeText={<ThinkingTimeSeconds isThinking={isThinking} />}
          isExpanded={effectiveExpanded}
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
                    className="min-w-0 flex-1 overflow-hidden text-[13px] leading-5 whitespace-nowrap text-muted-foreground">
                    {streamingPreviewText}
                  </span>
                )}
              </>
            ) : showTitlePreview && previewText ? (
              <span
                aria-hidden="true"
                className="min-w-0 flex-1 truncate text-[13px] leading-5 whitespace-nowrap text-muted-foreground">
                {previewText}
              </span>
            ) : null
          }
        />
      </div>
      <ScrollArea
        viewportProps={{
          ref: contentRef,
          id: contentId,
          onScroll: () => {
            const panel = contentRef.current
            if (!panel || !effectiveExpanded || !isStreaming) return
            followingRef.current = getDistanceToBottom(panel) <= VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX
          }
        }}

        hidden={!effectiveExpanded}
        type="auto"
        contentProps={{ className: 'px-4 py-3' }}
        className={isStreaming ? THINKING_CONTENT_PANEL_CAPPED_CLASSNAME : THINKING_CONTENT_PANEL_BASE_CLASSNAME}>
        <ThinkingBlockContent id={id} content={content} isStreaming={isStreaming} />
      </ScrollArea>
    </div>
  )
}

const ThinkingTimeSeconds = memo(({ isThinking }: { isThinking: boolean }) => {
  const { t } = useTranslation()

  if (isThinking) return t('message.tools.placeholder.thinking')
  return t('common.reasoning_content')
})

export default memo(ThinkingBlock)
