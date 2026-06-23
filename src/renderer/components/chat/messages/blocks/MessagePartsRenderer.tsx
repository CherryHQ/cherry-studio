/**
 * MessagePartsRenderer — message parts renderer.
 *
 * Routes CherryMessagePart[] directly to leaf components. No intermediate
 * block conversion — each part type is rendered from its raw data.
 *
 * Layout (when `collapseCompletedToolHistory` is on): the agentic process (tool
 * calls + reasoning) collapses behind one outer fold (`OuterProcessFold`) whose
 * header shows the live tool while streaming and a tool count once settled; the
 * answer renders below it. Expanding reveals the process in original order with
 * tool runs rendered directly beside the text between them.
 *
 * Within a segment, grouping logic:
 * - Consecutive file parts with image mediaType → image block row
 * - Consecutive tool-* / dynamic-tool parts → ToolBlockGroupContent row
 * - data-video parts with same filePath → video block row
 */

import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useIsActiveTurnTarget } from '@renderer/hooks/useIsActiveTurnTarget'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { FILE_TYPE } from '@renderer/types/file'
import { convertReferencesToCitationReferences, convertReferencesToCitations } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart, ContentReference, ReasoningUIPart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ErrorPartData, VideoPartData } from '@shared/data/types/uiParts'
import { isDataUIPart, isFileUIPart, isToolUIPart } from 'ai'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import MessageAttachments from '../frame/MessageAttachments'
import MessageVideo from '../frame/MessageVideo'
import { useMessageRenderConfig } from '../MessageListProvider'
import { isReportArtifactsToolResponse, MessageReportArtifacts } from '../tools/agent/ReportArtifacts'
import MessageTools, { canRenderMessageTool } from '../tools/MessageTools'
import { hasPartParentToolCallId } from '../tools/toolParentMetadata'
import { buildToolResponseFromPart, type ToolRenderItem } from '../tools/toolResponse'
import type { MessageListItem } from '../types'
import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import CompactionAnchorBlock from './CompactionAnchorBlock'
import ErrorBlock from './ErrorBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import { useMessageParts, useTranslationOverlayEntry } from './MessagePartsContext'
import PlaceholderBlock, { type PlaceholderStatus } from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import { ToolBlockGroupContent, ToolBlockGroupHeaderContent } from './ToolBlockGroup'
import TranslationBlock from './TranslationBlock'

const logger = loggerService.withContext('MessagePartsRenderer')

// ============================================================================
// Animation shared by message block renderers.
// ============================================================================

const blockWrapperVariants: Variants = {
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, type: 'spring', bounce: 0 }
  },
  hidden: {
    opacity: 0,
    x: 10
  },
  static: {
    opacity: 1,
    x: 0,
    transition: { duration: 0 }
  }
}

const blockWrapperFadeVariants: Variants = {
  visible: {
    opacity: 1,
    transition: { duration: 0.2 }
  },
  hidden: {
    opacity: 0
  }
}

const AnimatedBlockWrapper: React.FC<{
  children: React.ReactNode
  enableAnimation: boolean
  className?: string
  animation?: 'slide' | 'fade'
}> = ({ className, children, enableAnimation, animation = 'slide' }) => {
  const wrapperClassName = ['block-wrapper', className].filter(Boolean).join(' ')

  // Latch: Once a block has entered the motion.div branch during streaming (enableAnimation === true),
  // we keep it there forever (hasEverAnimated === true). Returning to a plain <div> when streaming
  // ends changes the React element type, triggering a full subtree remount which would destroy
  // child components' internal state (e.g. ThinkingBlock's timer and fold/unfold state) and cause flicker.
  const [hasEverAnimated, setHasEverAnimated] = React.useState(enableAnimation)

  React.useEffect(() => {
    if (enableAnimation) {
      setHasEverAnimated(true)
    }
  }, [enableAnimation])

  if (!hasEverAnimated) {
    return (
      <div className={wrapperClassName}>
        <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
      </div>
    )
  }
  const variants = animation === 'fade' ? blockWrapperFadeVariants : blockWrapperVariants
  return (
    <motion.div
      className={wrapperClassName}
      variants={enableAnimation ? variants : undefined}
      initial={enableAnimation ? 'hidden' : undefined}
      animate={enableAnimation ? 'visible' : undefined}>
      <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
    </motion.div>
  )
}

// ============================================================================
// Props
// ============================================================================

interface Props {
  message: MessageListItem
}

// ============================================================================
// Helpers
// ============================================================================

/** Check if a part is an image file part. */
function isImageFilePart(part: CherryMessagePart): boolean {
  return isFileUIPart(part) && part.mediaType.startsWith('image/')
}

/** Extract image URL from a file part. */
function extractImageUrl(part: CherryMessagePart): string | undefined {
  if (part.type !== 'file' || !('url' in part)) return undefined
  const filePart = part as { url?: string; mediaType?: string }
  return filePart.url || undefined
}

/** Get video filePath from a data-video part. */
function getVideoFilePath(part: CherryMessagePart): string | undefined {
  if (isDataUIPart(part) && part.type === 'data-video') {
    return part.data.filePath
  }
  return undefined
}

// ============================================================================
// Part grouping
// ============================================================================

type PartEntry = { part: CherryMessagePart; index: number }
type GroupedEntry = PartEntry | PartEntry[]

function groupPartEntries(entries: readonly PartEntry[]): GroupedEntry[] {
  return entries.reduce<GroupedEntry[]>((acc, entry) => {
    const { part } = entry

    if (isImageFilePart(part)) {
      const prev = acc[acc.length - 1]
      if (Array.isArray(prev) && isImageFilePart(prev[0].part)) {
        prev.push(entry)
      } else {
        acc.push([entry])
      }
    } else if (isToolUIPart(part)) {
      const prev = acc[acc.length - 1]
      if (Array.isArray(prev) && isToolUIPart(prev[0].part)) {
        prev.push(entry)
      } else {
        acc.push([entry])
      }
    } else if (isDataUIPart(part) && part.type === 'data-video') {
      const filePath = getVideoFilePath(part)
      const existingGroup = acc.find(
        (g) =>
          Array.isArray(g) &&
          isDataUIPart(g[0].part) &&
          g[0].part.type === 'data-video' &&
          getVideoFilePath(g[0].part) === filePath
      ) as PartEntry[] | undefined
      if (existingGroup) {
        existingGroup.push(entry)
      } else {
        acc.push([entry])
      }
    } else {
      acc.push(entry)
    }

    return acc
  }, [])
}

function isSummaryMessagePart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  if (partType === 'text') {
    return !!(part as { text?: string }).text?.trim()
  }
  if (partType === 'data-code') {
    return !!(part as { data?: { content?: string } }).data?.content?.trim()
  }
  if (partType === 'data-compact' || partType === 'data-translation') {
    return !!(part as { data?: { content?: string } }).data?.content?.trim()
  }
  if (partType === 'data-compaction-anchor') {
    return true
  }
  return false
}

function isReasoningMessagePart(part: CherryMessagePart): boolean {
  return (part.type as string) === 'reasoning' && !!(part as ReasoningUIPart).text?.trim()
}

function isResultPart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  return isSummaryMessagePart(part) || partType === 'data-error' || partType === 'file' || partType === 'data-video'
}

/**
 * "Process" parts are the low-value steps of an agentic turn — tool calls,
 * reasoning, and hidden markers — that get tucked into a collapsed fold so the
 * model's actual prose reads as a clean conversation. Everything else (text,
 * code, errors, images, files, video) is "value" content shown directly.
 */
function isProcessPart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  return (
    isToolUIPart(part) ||
    partType === 'reasoning' ||
    partType === 'step-start' ||
    partType === 'source-url' ||
    partType === 'data-citation' ||
    partType === 'data-agent-task-event'
  )
}

function getProcessingPlaceholderStatus(entries: readonly PartEntry[]): PlaceholderStatus {
  for (let index = entries.length - 1; index >= 0; index--) {
    const { part } = entries[index]
    if (isToolUIPart(part)) return 'usingTools'
    if (isReasoningMessagePart(part)) return 'thinking'
    if (isResultPart(part)) return 'generating'
  }

  return 'preparing'
}

// ============================================================================
// Render helpers — Batch 1 stable components
// ============================================================================

/** Extract CherryProviderMetadata from a part. */
function getCherryMeta(part: CherryMessagePart): CherryProviderMetadata | undefined {
  if ('providerMetadata' in part && part.providerMetadata) {
    return part.providerMetadata.cherry as CherryProviderMetadata | undefined
  }
  return undefined
}

/**
 * Memoized adapter from `ErrorPartData` (with optional name/message/stack) to
 * the normalized `SerializedError` shape `ErrorBlock` consumes. Lives here —
 * not inline in the switch — so the normalized object's identity is tied to
 * `rawData`, not to whichever render of the parent triggered it. Keeping
 * identity stable lets `React.memo(ErrorBlock)` and the downstream `useMemo`s
 * actually do their job; an inline spread would mint a fresh object every
 * render and silently break memoization.
 */
const ErrorPartView = React.memo(function ErrorPartView({
  partId,
  rawData,
  message
}: {
  partId: string
  rawData: ErrorPartData
  message: MessageListItem
}) {
  const error = useMemo(
    () => ({
      ...rawData,
      name: rawData.name ?? null,
      message: rawData.message ?? null,
      stack: rawData.stack ?? null
    }),
    [rawData]
  )
  return <ErrorBlock partId={partId} error={error} message={message} />
})

/**
 * Render a single part directly from CherryMessagePart — no MessageBlock conversion.
 *
 * Data extraction happens HERE — leaf components receive pure view props only.
 */
function renderPart(
  part: CherryMessagePart,
  partId: string,
  message: MessageListItem,
  isStreaming: boolean,
  isTranslationOverlayActive: boolean
): React.ReactNode {
  const partType = part.type as string

  switch (partType) {
    case 'reasoning': {
      const reasoningPart = part as ReasoningUIPart
      const cherryMeta = getCherryMeta(part)
      const metadataBlock =
        'providerMetadata' in part && part.providerMetadata
          ? ((part.providerMetadata as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
          : undefined
      const thinkingMs =
        cherryMeta?.thinkingMs ??
        (typeof metadataBlock?.thinking_millsec === 'number' ? metadataBlock.thinking_millsec : 0)
      const startedAt = cherryMeta?.startedAt
      return (
        <ThinkingBlock
          key={partId}
          id={partId}
          content={reasoningPart.text || ''}
          isStreaming={reasoningPart.state === 'streaming'}
          thinkingMs={thinkingMs}
          thoughtsTokens={message.stats?.thoughtsTokens}
          startedAt={startedAt}
        />
      )
    }

    case 'data-compact': {
      const compactData = (part as { data: { content: string; compactedContent: string } }).data
      return (
        <CompactBlock
          key={partId}
          id={partId}
          content={compactData.content}
          compactedContent={compactData.compactedContent}
        />
      )
    }

    case 'data-compaction-anchor':
      return <CompactionAnchorBlock key={partId} />

    case 'data-translation': {
      const translationData = (part as { data: { content: string } }).data
      return (
        <TranslationBlock
          key={partId}
          id={partId}
          content={translationData.content}
          isStreaming={isStreaming || isTranslationOverlayActive}
        />
      )
    }

    case 'text': {
      const textPart = part as { text?: string }
      const cherryMeta = getCherryMeta(part)
      const citations = cherryMeta?.references
        ? convertReferencesToCitations(cherryMeta.references as ContentReference[])
        : []
      const citationReferences = cherryMeta?.references
        ? convertReferencesToCitationReferences(cherryMeta.references as ContentReference[], partId)
        : undefined
      return (
        <MainTextBlock
          key={partId}
          id={partId}
          content={textPart.text || ''}
          isStreaming={isStreaming}
          citations={citations}
          citationReferences={citationReferences}
          role={message.role}
          composer={cherryMeta?.composer}
        />
      )
    }

    case 'data-code': {
      const codeData = (part as { data: { content: string; language?: string } }).data
      const codeContent = `\`\`\`${codeData.language ?? ''}\n${codeData.content}\n\`\`\``
      return (
        <MainTextBlock key={partId} id={partId} content={codeContent} isStreaming={isStreaming} role={message.role} />
      )
    }

    case 'data-error': {
      const rawData = 'data' in part ? (part.data as ErrorPartData) : undefined
      if (!rawData) return null
      return <ErrorPartView key={partId} partId={partId} rawData={rawData} message={message} />
    }

    case 'data-video': {
      const rawData = 'data' in part ? (part.data as VideoPartData) : undefined
      if (!rawData) return null
      return <MessageVideo key={partId} url={rawData.url} filePath={rawData.filePath} />
    }

    case 'data-citation':
      // Citation data is embedded in MainTextBlock.citationReferences; no standalone render is needed.
      return null

    case 'data-agent-task-event':
      // Agent task events are hidden inline state consumed by the agent status panes.
      return null

    case 'file': {
      const filePart = part as { url?: string; mediaType?: string; filename?: string }
      if (filePart.mediaType?.startsWith('image/')) {
        const url = filePart.url
        if (!url) return null
        return <ImageBlock key={partId} images={[url]} isSingle={true} />
      }
      if (!filePart.url) {
        logger.warn('File part has no url, skipping', { filename: filePart.filename })
        return null
      }
      return (
        <MessageAttachments
          key={partId}
          file={{
            id: partId,
            name: filePart.filename || '',
            origin_name: filePart.filename || '',
            path: filePart.url.replace('file://', ''),
            size: 0,
            ext: '',
            type: FILE_TYPE.OTHER,
            created_at: message.createdAt,
            count: 0
          }}
        />
      )
    }

    case 'source-url':
    case 'step-start':
      return null

    default: {
      if (isToolUIPart(part)) {
        return renderToolPart(part, partId)
      }

      logger.warn('Unknown part type in MessagePartsRenderer', { type: partType })
      return null
    }
  }
}

const ToolPartView = React.memo(function ToolPartView({ part, partId }: { part: CherryMessagePart; partId: string }) {
  const toolResponse = useMemo(() => buildToolResponseFromPart(part, partId), [part, partId])
  if (!toolResponse) return null
  return <MessageTools toolResponse={toolResponse} />
})

function renderToolPart(part: CherryMessagePart, partId: string): React.ReactNode {
  return <ToolPartView key={partId} part={part} partId={partId} />
}

function buildToolRenderItems(entries: readonly PartEntry[], messageId: string): ToolRenderItem[] {
  return entries.flatMap((e): ToolRenderItem[] => {
    const id = `${messageId}-part-${e.index}`
    const toolResponse = buildToolResponseFromPart(e.part, id)
    return toolResponse && canRenderMessageTool(toolResponse) ? [{ id, toolResponse }] : []
  })
}

function getReportArtifactToolResponses(entries: readonly PartEntry[], messageId: string) {
  return entries.flatMap((entry) => {
    const toolResponse = buildToolResponseFromPart(entry.part, `${messageId}-part-${entry.index}`)
    return toolResponse && isReportArtifactsToolResponse(toolResponse) ? [toolResponse] : []
  })
}

function renderGroupedEntry(
  entry: GroupedEntry,
  message: MessageListItem,
  isStreaming: boolean,
  isTranslationOverlayActive: boolean
): React.ReactNode {
  if (Array.isArray(entry)) {
    const groupKey = entry.map((e) => `${message.id}-part-${e.index}`).join('-')
    const firstPart = entry[0].part

    if (isImageFilePart(firstPart)) {
      const images = entry.map((e) => extractImageUrl(e.part)).filter(Boolean) as string[]
      if (images.length === 0) return null

      if (images.length === 1) {
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
            <ImageBlock images={images} isSingle={true} />
          </AnimatedBlockWrapper>
        )
      }
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxWidth: '100%' }}>
            {images.map((src, i) => (
              <ImageBlock key={`${groupKey}-img-${i}`} images={[src]} isSingle={false} />
            ))}
          </div>
        </AnimatedBlockWrapper>
      )
    }

    if (isToolUIPart(firstPart)) {
      const toolItems = buildToolRenderItems(entry, message.id)
      if (toolItems.length === 0) return null

      const stableGroupKey = `tool-group-${message.id}-part-${entry[0].index}`
      return (
        <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={isStreaming} animation="fade">
          <ToolBlockGroupContent items={toolItems} />
        </AnimatedBlockWrapper>
      )
    }

    if (isDataUIPart(firstPart) && firstPart.type === 'data-video') {
      const firstEntry = entry[0]
      const partId = `${message.id}-part-${firstEntry.index}`
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
          {renderPart(firstEntry.part, partId, message, isStreaming, isTranslationOverlayActive)}
        </AnimatedBlockWrapper>
      )
    }

    return null
  }

  const partId = `${message.id}-part-${entry.index}`
  const rendered = renderPart(entry.part, partId, message, isStreaming, isTranslationOverlayActive)
  if (!rendered) return null

  return (
    <AnimatedBlockWrapper
      key={partId}
      enableAnimation={isStreaming}
      className={isReasoningMessagePart(entry.part) ? 'message-thought-wrapper' : undefined}>
      {rendered}
    </AnimatedBlockWrapper>
  )
}

/**
 * Locate the agentic "process" (tool calls + reasoning) preceding the
 * assistant's answer. `collapsedEntries` is the process — everything up to and
 * including the trailing non-tool process tail; `resultEntries` is the answer
 * content (if any) that follows. Returns null when there is no tool history
 * worth folding: no tools, or a settled message that simply ends on a tool with
 * no answer/tail (rendered inline instead).
 */
function getToolHistoryGroup(
  entries: readonly PartEntry[],
  message: MessageListItem,
  isProcessing: boolean
): { collapsedEntries: PartEntry[]; resultEntries: PartEntry[]; toolCount: number; hasResult: boolean } | null {
  if (message.role !== 'assistant') return null

  let lastToolIndex = -1
  for (let index = entries.length - 1; index >= 0; index--) {
    if (isToolUIPart(entries[index].part)) {
      lastToolIndex = index
      break
    }
  }
  if (lastToolIndex < 0) return null

  let collapsedEnd = lastToolIndex
  for (let index = lastToolIndex + 1; index < entries.length; index++) {
    if (!isProcessPart(entries[index].part)) break
    collapsedEnd = index
  }

  const collapsedEntries = entries.slice(0, collapsedEnd + 1)
  const resultEntries = entries.slice(collapsedEnd + 1)
  const hasResult = resultEntries.some((entry) => isResultPart(entry.part))
  const hasCollapsedTail = collapsedEnd > lastToolIndex
  if (message.status === 'success' && !isProcessing && !hasResult && !hasCollapsedTail) return null

  const toolCount = buildToolRenderItems(collapsedEntries, message.id).length
  if (toolCount === 0) return null

  return { collapsedEntries, resultEntries, toolCount, hasResult }
}

/** Whether trailing reasoning after the last tool is still streaming — drives
 * the "thinking" hint in the live fold header. */
function hasStreamingReasoningAfterLastTool(entries: readonly PartEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const { part } = entries[index]
    if (isToolUIPart(part)) return false
    if ((part.type as string) === 'reasoning' && (part as ReasoningUIPart).state === 'streaming') return true
  }
  return false
}

/**
 * The big outer fold for the whole agentic process. Collapsed by default; while
 * the turn is live its header shows the current tool being called (the live
 * "tool change" display), settling to a "N tool calls" count once done. Only on
 * manual expand does it reveal the process in order. The final answer renders
 * outside, below this fold.
 */
const OuterProcessFold = React.memo(function OuterProcessFold({
  entries,
  message,
  toolCount,
  hasResult,
  isProcessing
}: {
  entries: readonly PartEntry[]
  message: MessageListItem
  toolCount: number
  hasResult: boolean
  isProcessing: boolean
}) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = React.useState(false)
  const contentId = React.useId()

  const toolItems = useMemo(() => buildToolRenderItems(entries, message.id), [entries, message.id])
  const groupedEntries = useMemo(() => groupPartEntries(entries), [entries])
  const showLiveProgress = (isProcessing || message.status !== 'success') && !hasResult
  const activityLabel =
    showLiveProgress && hasStreamingReasoningAfterLastTool(entries) ? t('message.tools.thinkingHeader') : undefined
  const triggerClassName = [
    !showLiveProgress && '-ml-0.5',
    'flex min-h-7',
    isExpanded ? 'w-full' : 'w-fit',
    'items-center justify-start gap-1.5 rounded border-0 bg-transparent px-0 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`group/process-history max-w-full ${isExpanded ? 'w-full' : 'w-fit'}`}>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className={triggerClassName}
        onClick={() => setIsExpanded((expanded) => !expanded)}>
        {!showLiveProgress && (
          <ChevronDown
            size={16}
            className={`shrink-0 text-foreground-muted transition-transform duration-150 ${isExpanded ? 'rotate-180' : '-rotate-90'}`}
          />
        )}
        <ToolBlockGroupHeaderContent
          items={toolItems}
          activityLabel={activityLabel}
          summary={t('message.tools.groupHeader', { count: toolCount })}
          isLiveProgress={showLiveProgress}
          showLatestWhenComplete={showLiveProgress}
        />
      </button>
      {isExpanded && (
        <div
          id={contentId}
          className="mt-1.5 flex w-full flex-col gap-2 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!">
          {groupedEntries.map((entry) => renderGroupedEntry(entry, message, false, false))}
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Main component
// ============================================================================

const MessagePartsRenderer: React.FC<Props> = ({ message }) => {
  const messageParts = useMessageParts(message.id)
  const { isPending: isTopicStreaming } = useTopicStreamStatus(message.topicId)
  const isStreaming = isTopicStreaming && message.status === 'pending'
  const isTranslationOverlayActive = useTranslationOverlayEntry(message.id) !== undefined
  const renderConfig = useMessageRenderConfig()

  // Beat loader visible only when THIS specific message is the active turn
  // target. The identity predicate lives in `useIsActiveTurnTarget` so
  // consumers do not over-scope topic-level stream status to user messages.
  const isProcessing = useIsActiveTurnTarget(message)

  const partEntries = useMemo(
    () => messageParts.flatMap((part, index) => (hasPartParentToolCallId(part) ? [] : [{ part, index }])),
    [messageParts]
  )
  const placeholderStatus = useMemo(() => getProcessingPlaceholderStatus(partEntries), [partEntries])
  const collapseEnabled = renderConfig.collapseCompletedToolHistory
  // The whole agentic process (tools + reasoning) collapses behind one outer
  // fold; the answer that follows renders below it. Present throughout the turn
  // (collapsed, live header while streaming) so it never flips in/out.
  const toolHistoryGroup = useMemo(
    () => (collapseEnabled ? getToolHistoryGroup(partEntries, message, isProcessing) : null),
    [collapseEnabled, partEntries, message, isProcessing]
  )
  const reportArtifactToolResponses = useMemo(
    () => getReportArtifactToolResponses(partEntries, message.id),
    [partEntries, message.id]
  )
  // Everything not folded into the history group renders flat: the answer after
  // the fold, or all parts when there's no fold (no tools / collapse disabled).
  const visibleEntries = toolHistoryGroup?.resultEntries ?? partEntries
  const grouped = useMemo(() => (visibleEntries.length === 0 ? [] : groupPartEntries(visibleEntries)), [visibleEntries])

  // No parts to render — normal for user messages (content is in message text, not parts)
  // But if the message is processing (pending/streaming), show the loading placeholder
  if (partEntries.length === 0) {
    if (isProcessing) {
      return (
        <AnimatePresence mode="sync">
          <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
            <PlaceholderBlock isProcessing={true} createdAt={message.createdAt} status={placeholderStatus} />
          </AnimatedBlockWrapper>
        </AnimatePresence>
      )
    }
    return null
  }

  return (
    <AnimatePresence mode="sync">
      {isProcessing && (
        <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
          <PlaceholderBlock isProcessing={true} createdAt={message.createdAt} status={placeholderStatus} />
        </AnimatedBlockWrapper>
      )}
      {toolHistoryGroup && (
        <AnimatedBlockWrapper key={`tool-history-${message.id}`} enableAnimation={false}>
          <OuterProcessFold
            entries={toolHistoryGroup.collapsedEntries}
            message={message}
            toolCount={toolHistoryGroup.toolCount}
            hasResult={toolHistoryGroup.hasResult}
            isProcessing={isProcessing}
          />
        </AnimatedBlockWrapper>
      )}
      {grouped.map((entry) => renderGroupedEntry(entry, message, isStreaming, isTranslationOverlayActive))}
      {reportArtifactToolResponses.length > 0 && (
        <AnimatedBlockWrapper key={`report-artifacts-${message.id}`} enableAnimation={isStreaming} animation="fade">
          <MessageReportArtifacts toolResponses={reportArtifactToolResponses} />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
}

export default React.memo(MessagePartsRenderer)
