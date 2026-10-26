import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import { type MarkdownSource, Scrollbar } from '@cherrystudio/ui'
import { thinkingScrollService, type ThinkingScrollSnapshot } from '@renderer/services/ThinkingScrollService'

import { getDistanceToBottom, getRealBottom } from '../list/scrollGeometry'
import { VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX } from '../list/ScrollOwnershipContext'
import ChatMarkdown from '../markdown/ChatMarkdown'
import { useMessageRenderConfig } from '../MessageListProvider'
import ThinkingEffect from './ThinkingEffect'
import { normalizeThinkingPreview, scanThinkingPreview, type ThinkingPreviewScanState } from './thinkingPreview'
import { useMinimumDisplayDuration } from './useMinimumDisplayDuration'
import { useScrollAnchor } from './useScrollAnchor'

const THINKING_PREVIEW_MIN_DURATION_MS = 1000
const THINKING_CONTENT_PANEL_CLASSNAME =
  'mt-1.5 max-h-[min(32rem,60dvh)] overflow-auto rounded-xl bg-muted px-4 py-3 text-[13px] leading-5 text-muted-foreground'

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
})
ThinkingBlockContent.displayName = 'ThinkingBlockContent'

const ThinkingBlock: React.FC<Props> = ({ id, content, isStreaming, showTitlePreview = false }) => {
  const { thoughtAutoCollapse } = useMessageRenderConfig()
  const [saved] = useState(() => thinkingScrollService.read(id))
  const [isExpanded, setIsExpanded] = useState(saved?.isExpanded ?? !thoughtAutoCollapse)
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(saved?.following ?? true)
  const pendingRestoreRef = useRef(saved)
  const restoredScrollTopRef = useRef<number | undefined>(undefined)
  const lastSnapshotRef = useRef<ThinkingScrollSnapshot | undefined>(saved)
  const expandedRef = useRef(isExpanded)
  expandedRef.current = isExpanded
  const preferenceRef = useRef(thoughtAutoCollapse)
  const hasContent = !!content

  const savePanel = useCallback(
    (panel: HTMLDivElement) => {
      const previous = lastSnapshotRef.current
      if (previous && thinkingScrollService.read(id) !== previous) return
      const measurable = !pendingRestoreRef.current && !panel.hidden && panel.clientHeight > 0
      if (!measurable && !previous) return
      const snapshot = {
        scrollTop: measurable ? panel.scrollTop : previous!.scrollTop,
        following: followingRef.current,
        isExpanded: expandedRef.current
      }
      thinkingScrollService.write(id, snapshot)
      lastSnapshotRef.current = thinkingScrollService.read(id)
    },
    [id]
  )

  const restorePanel = useCallback((panel: HTMLDivElement) => {
    const pending = pendingRestoreRef.current
    if (!pending) return true
    if (panel.hidden || panel.clientHeight <= 0) return false
    const target = pending.following
      ? getRealBottom(panel)
      : Math.min(Math.max(0, pending.scrollTop), getRealBottom(panel))
    panel.scrollTop = target
    restoredScrollTopRef.current = target
    pendingRestoreRef.current = undefined
    return true
  }, [])

  useLayoutEffect(() => {
    const panel = contentRef.current
    if (!panel) return
    restorePanel(panel)
    savePanel(panel)
    return () => savePanel(panel)
  })

  useEffect(() => {
    const panel = contentRef.current
    if (!panel || !isExpanded || (!isStreaming && !pendingRestoreRef.current)) return
    const observer = new ResizeObserver(() => {
      if (!restorePanel(panel) || panel.hidden || panel.clientHeight <= 0) return
      if (isStreaming && followingRef.current) panel.scrollTop = getRealBottom(panel)
      savePanel(panel)
    })
    observer.observe(panel)
    if (panel.firstElementChild) observer.observe(panel.firstElementChild)
    return () => observer.disconnect()
  }, [hasContent, isExpanded, isStreaming, restorePanel, savePanel])
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
    if (preferenceRef.current === thoughtAutoCollapse) return
    preferenceRef.current = thoughtAutoCollapse
    setIsExpanded(!thoughtAutoCollapse)
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
      <Scrollbar
        ref={contentRef}
        id={contentId}
        hidden={!isExpanded}
        autoHideScrollbar={false}
        className={THINKING_CONTENT_PANEL_CLASSNAME}
        onScroll={() => {
          const panel = contentRef.current
          if (!panel || !isExpanded || panel.clientHeight <= 0 || pendingRestoreRef.current) return
          if (panel.scrollTop === restoredScrollTopRef.current) return
          restoredScrollTopRef.current = undefined
          followingRef.current = getDistanceToBottom(panel) <= VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX
          savePanel(panel)
        }}>
        <ThinkingBlockContent id={id} content={content} isStreaming={isStreaming} />
      </Scrollbar>
    </div>
  )
}

const ThinkingTimeSeconds = memo(({ isThinking }: { isThinking: boolean }) => {
  const { t } = useTranslation()

  if (isThinking) return t('message.tools.placeholder.thinking')
  return t('common.reasoning_content')
})

export default memo(ThinkingBlock)
