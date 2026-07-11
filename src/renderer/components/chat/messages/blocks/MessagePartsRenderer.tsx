/**
 * MessagePartsRenderer — message parts renderer.
 *
 * Routes CherryMessagePart[] directly to leaf components. No intermediate
 * block conversion — each part type is rendered from its raw data.
 *
 * Active and terminal messages use separate projections. While active, model
 * prose stays inline and uninterrupted reasoning/tool runs become transparent,
 * bounded disclosures. Once terminal, process history may collapse behind the
 * completed summary while the final substantive answer stays outside it.
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
import { readComposerFileTokenIdSuffix } from '@renderer/utils/message/composerFileTokenSource'
import { getDisplayComposerTokens } from '@renderer/utils/message/composerTokens'
import { convertReferencesToCitationReferences, convertReferencesToCitations } from '@renderer/utils/partsToBlocks'
import { classifyTurn } from '@shared/ai/transport'
import type { CherryMessagePart, ContentReference, ReasoningUIPart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ComposerMessageToken, ErrorPartData } from '@shared/data/types/uiParts'
import { getToolName, isDataUIPart, isFileUIPart, isToolUIPart } from 'ai'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useMemo } from 'react'

import MessageAttachments from '../frame/MessageAttachments'
import MessageVideo from '../frame/MessageVideo'
import { useMessageRenderConfig } from '../MessageListProvider'
import { isReportArtifactsToolResponse, MessageReportArtifacts } from '../tools/agent'
import MessageTools, { canRenderMessageTool } from '../tools/MessageTools'
import { isAskUserQuestionToolName } from '../tools/shared/agentToolTypes'
import { hasPartParentToolCallId } from '../tools/toolParentMetadata'
import { buildToolResponseFromPart, type ToolRenderItem, type ToolResponseLike } from '../tools/toolResponse'
import type { MessageListItem } from '../types'
import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import CompactionAnchorBlock from './CompactionAnchorBlock'
import CompletedProcessHistory from './CompletedProcessHistory'
import ErrorBlock from './ErrorBlock'
import ImageBlock from './ImageBlock'
import LiveProcessRun from './LiveProcessRun'
import LiveProcessToolList from './LiveProcessToolList'
import MainTextBlock, { buildUserMessagePreview } from './MainTextBlock'
import {
  findOpenTextTailIndex,
  type LiveMessagePartLayoutItem,
  type PartEntry,
  projectCompletedMessageParts,
  projectLiveMessageParts
} from './messagePartLayouts'
import { useMessageParts, useTranslationOverlayEntry } from './MessagePartsContext'
import PlaceholderBlock, { type PlaceholderStatus } from './PlaceholderBlock'
import { useRequestScrollFollowRecovery } from './ScrollOwnershipContext'
import ThinkingBlock, { ThinkingBlockContent } from './ThinkingBlock'
import { ToolBlockGroupContent } from './ToolBlockGroup'
import TranslationBlock from './TranslationBlock'

const logger = loggerService.withContext('MessagePartsRenderer')
const TOOL_HISTORY_REASONING_DISPLAY_LIMIT = 3
const EMPTY_PART_ENTRIES: readonly PartEntry[] = []

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

type GroupedEntry = PartEntry | PartEntry[]

interface RenderGroupedEntryOptions {
  enableAnimation?: boolean
  expandedTextPartIds?: ReadonlySet<string>
  onTextPartExpandedChange?: (partId: string, expanded: boolean) => void
  reasoningDisplay?: 'content' | 'disclosure'
  settleActiveTools?: boolean
  settleStreamingReasoning?: boolean
}

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
      if (isAskUserQuestionToolName(getToolName(part))) {
        acc.push(entry)
        return acc
      }
      const prev = acc[acc.length - 1]
      if (Array.isArray(prev) && isToolUIPart(prev[0].part)) {
        prev.push(entry)
      } else {
        acc.push([entry])
      }
    } else if (isDataUIPart(part) && part.type === 'data-video') {
      const filePath = getVideoFilePath(part)
      const prev = acc[acc.length - 1]
      if (
        Array.isArray(prev) &&
        isDataUIPart(prev[0].part) &&
        prev[0].part.type === 'data-video' &&
        getVideoFilePath(prev[0].part) === filePath
      ) {
        prev.push(entry)
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

interface VisibleComposerFileToken {
  sourceId?: string
  names: Set<string>
}

function isComposerTokenVisibleInText(token: ComposerMessageToken, text: string): boolean {
  if (!token.promptText) return true
  const offset = Math.max(0, Math.min(text.length, token.textOffset))
  return text.slice(offset, offset + token.promptText.length) === token.promptText
}

function getComposerFileTokenNames(token: ComposerMessageToken): Set<string> {
  const names = [token.payload?.origin_name, token.payload?.name, token.label].filter((name): name is string => !!name)
  return new Set(names)
}

function getComposerTokenDisplayText(
  part: CherryMessagePart,
  message: MessageListItem,
  partId: string,
  expandedTextPartIds: ReadonlySet<string>
): string {
  const text = (part as { text?: string }).text ?? ''
  if (message.role !== 'user' || expandedTextPartIds.has(partId)) return text

  return buildUserMessagePreview(text).content
}

function getVisibleComposerFileTokens(
  parts: readonly CherryMessagePart[],
  message: MessageListItem,
  expandedTextPartIds: ReadonlySet<string>
): VisibleComposerFileToken[] {
  return parts.flatMap((part, index) => {
    if ((part.type as string) !== 'text') return []
    const composer = getCherryMeta(part)?.composer
    if (!composer) return []
    const partId = `${message.id}-part-${index}`
    const text = getComposerTokenDisplayText(part, message, partId, expandedTextPartIds)

    return getDisplayComposerTokens(composer).flatMap((token) => {
      if (token.kind !== 'file' || !isComposerTokenVisibleInText(token, text)) return []
      return [{ sourceId: readComposerFileTokenIdSuffix(token.id), names: getComposerFileTokenNames(token) }]
    })
  })
}

function getFileEntrySourceId(entry: PartEntry): string | undefined {
  return getCherryMeta(entry.part)?.fileTokenSourceId
}

function getFileEntryName(entry: PartEntry): string {
  const filePart = entry.part as { filename?: string; url?: string }
  return (
    filePart.filename ||
    filePart.url
      ?.split(/[\\/]/)
      .pop()
      ?.replace(/^file:\/\//, '') ||
    ''
  )
}

function findUniqueVisibleFileTokenIndex(
  tokens: readonly VisibleComposerFileToken[],
  usedTokenIndexes: ReadonlySet<number>,
  matches: (token: VisibleComposerFileToken) => boolean
): number | undefined {
  const matchingIndexes = tokens.flatMap((token, index) =>
    !usedTokenIndexes.has(index) && matches(token) ? [index] : []
  )
  return matchingIndexes.length === 1 ? matchingIndexes[0] : undefined
}

function getDisplayEntries(
  entries: readonly PartEntry[],
  message: MessageListItem,
  visibleComposerFileTokens: readonly VisibleComposerFileToken[]
): PartEntry[] {
  if (message.role !== 'user' || visibleComposerFileTokens.length === 0) return [...entries]

  const fileEntryNameCounts = new Map<string, number>()
  for (const entry of entries) {
    if ((entry.part.type as string) !== 'file') continue

    const name = getFileEntryName(entry)
    if (name) fileEntryNameCounts.set(name, (fileEntryNameCounts.get(name) ?? 0) + 1)
  }

  const usedTokenIndexes = new Set<number>()
  return entries.filter((entry) => {
    if ((entry.part.type as string) !== 'file') return true

    const sourceId = getFileEntrySourceId(entry)
    const sourceMatchIndex = sourceId
      ? findUniqueVisibleFileTokenIndex(
          visibleComposerFileTokens,
          usedTokenIndexes,
          (token) => token.sourceId === sourceId
        )
      : undefined
    if (sourceMatchIndex !== undefined) {
      usedTokenIndexes.add(sourceMatchIndex)
      return false
    }

    const name = getFileEntryName(entry)
    const nameMatchIndex =
      name && fileEntryNameCounts.get(name) === 1
        ? findUniqueVisibleFileTokenIndex(visibleComposerFileTokens, usedTokenIndexes, (token) => token.names.has(name))
        : undefined
    if (nameMatchIndex !== undefined) {
      usedTokenIndexes.add(nameMatchIndex)
      return false
    }

    return true
  })
}

function getProcessingPlaceholderStatus(entries: readonly PartEntry[]): PlaceholderStatus {
  for (let index = entries.length - 1; index >= 0; index--) {
    const { part } = entries[index]
    if (isToolUIPart(part)) return 'usingTools'
    if ((part.type as string) === 'reasoning' && (part as ReasoningUIPart).state === 'streaming') return 'thinking'
    if (isReasoningMessagePart(part)) return 'thinking'
    if ((part.type as string) === 'text' || (part.type as string) === 'data-code') return 'generating'
    if (isResultPart(part)) return 'generating'
  }

  return 'preparing'
}

function isPotentiallyVisibleEntry(entry: PartEntry, messageId: string): boolean {
  const { part } = entry
  const partType = part.type as string

  if (
    partType === 'source-url' ||
    partType === 'source-document' ||
    partType === 'step-start' ||
    partType === 'data-citation' ||
    partType === 'data-agent-task-event'
  ) {
    return false
  }
  if (partType === 'reasoning') return isReasoningMessagePart(part)
  if (
    partType === 'text' ||
    partType === 'data-code' ||
    partType === 'data-compact' ||
    partType === 'data-translation'
  ) {
    return isSummaryMessagePart(part)
  }
  if (isToolUIPart(part)) {
    const toolResponse = getCachedToolProjection(part, `${messageId}-part-${entry.index}`).toolResponse
    return !!toolResponse && (canRenderMessageTool(toolResponse) || isReportArtifactsToolResponse(toolResponse))
  }
  if (partType === 'file') return !!(part as { url?: string }).url
  if (partType === 'data-video' || partType === 'data-error') return 'data' in part && !!part.data
  return true
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
  isTranslationOverlayActive: boolean,
  options?: RenderGroupedEntryOptions
): React.ReactNode {
  const partType = part.type
  if ((partType as string) === 'data-citation') return null

  switch (partType) {
    case 'reasoning': {
      const reasoningPart = part
      const isReasoningStreaming = !options?.settleStreamingReasoning && reasoningPart.state === 'streaming'
      if (options?.reasoningDisplay === 'content') {
        return (
          <ThinkingBlockContent
            key={partId}
            id={partId}
            content={reasoningPart.text || ''}
            isStreaming={isReasoningStreaming}
          />
        )
      }
      return (
        <ThinkingBlock key={partId} id={partId} content={reasoningPart.text || ''} isStreaming={isReasoningStreaming} />
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
          content={part.text || ''}
          isStreaming={isStreaming}
          citations={citations}
          citationReferences={citationReferences}
          role={message.role}
          composer={cherryMeta?.composer}
          userContentExpanded={message.role === 'user' ? options?.expandedTextPartIds?.has(partId) : undefined}
          onUserContentExpandedChange={
            message.role === 'user' && options?.onTextPartExpandedChange
              ? (expanded) => options.onTextPartExpandedChange?.(partId, expanded)
              : undefined
          }
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
      const rawData = 'data' in part ? part.data : undefined
      if (!rawData) return null
      return <ErrorPartView key={partId} partId={partId} rawData={rawData} message={message} />
    }

    case 'data-video': {
      const rawData = 'data' in part ? part.data : undefined
      if (!rawData) return null
      return <MessageVideo key={partId} url={rawData.url} filePath={rawData.filePath} />
    }

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
    case 'source-document':
    case 'step-start':
      return null

    default: {
      if (isToolUIPart(part)) {
        return renderToolPart(part, partId, options?.settleActiveTools)
      }

      logger.warn('Unknown part type in MessagePartsRenderer', { type: partType })
      return null
    }
  }
}

interface CachedToolProjection {
  renderItem?: ToolRenderItem
  toolResponse: ToolResponseLike | null
}

const toolProjectionCache = new WeakMap<object, Map<string, CachedToolProjection>>()

function getCachedToolProjection(part: CherryMessagePart, partId: string): CachedToolProjection {
  const cacheKey = part as object
  let projectionsById = toolProjectionCache.get(cacheKey)
  if (!projectionsById) {
    projectionsById = new Map()
    toolProjectionCache.set(cacheKey, projectionsById)
  }

  const cached = projectionsById.get(partId)
  if (cached) return cached

  const toolResponse = buildToolResponseFromPart(part, partId)
  const projection: CachedToolProjection = { toolResponse }
  if (toolResponse && canRenderMessageTool(toolResponse)) {
    projection.renderItem = { id: partId, toolResponse }
  }
  projectionsById.set(partId, projection)
  return projection
}

function settleToolResponse(toolResponse: ToolResponseLike): ToolResponseLike {
  if (!['pending', 'invoking', 'streaming'].includes(toolResponse.status)) return toolResponse
  return { ...toolResponse, status: 'cancelled' }
}

const ToolPartView = React.memo(function ToolPartView({
  part,
  partId,
  settleActiveTools
}: {
  part: CherryMessagePart
  partId: string
  settleActiveTools?: boolean
}) {
  const toolResponse = getCachedToolProjection(part, partId).toolResponse
  if (!toolResponse) return null
  return <MessageTools toolResponse={settleActiveTools ? settleToolResponse(toolResponse) : toolResponse} />
})

function renderToolPart(part: CherryMessagePart, partId: string, settleActiveTools?: boolean): React.ReactNode {
  return <ToolPartView key={partId} part={part} partId={partId} settleActiveTools={settleActiveTools} />
}

function settleToolRenderItem(item: ToolRenderItem): ToolRenderItem {
  const toolResponse = settleToolResponse(item.toolResponse)
  return toolResponse === item.toolResponse ? item : { ...item, toolResponse }
}

function buildToolRenderItems(
  entries: readonly PartEntry[],
  messageId: string,
  settleActiveTools = false
): ToolRenderItem[] {
  return entries.flatMap((e): ToolRenderItem[] => {
    const id = `${messageId}-part-${e.index}`
    const renderItem = getCachedToolProjection(e.part, id).renderItem
    return renderItem ? [settleActiveTools ? settleToolRenderItem(renderItem) : renderItem] : []
  })
}

function getReportArtifactToolResponses(entries: readonly PartEntry[], messageId: string) {
  return entries.flatMap((entry) => {
    const toolResponse = getCachedToolProjection(entry.part, `${messageId}-part-${entry.index}`).toolResponse
    return toolResponse && isReportArtifactsToolResponse(toolResponse) ? [toolResponse] : []
  })
}

function isReportArtifactEntry(entry: PartEntry, messageId: string): boolean {
  const toolResponse = getCachedToolProjection(entry.part, `${messageId}-part-${entry.index}`).toolResponse
  return !!toolResponse && isReportArtifactsToolResponse(toolResponse)
}

function useStableItemArray<T>(items: T[]): T[] {
  const stableRef = React.useRef(items)
  if (stableRef.current.length !== items.length || stableRef.current.some((item, index) => item !== items[index])) {
    stableRef.current = items
  }
  return stableRef.current
}

function renderGroupedEntry(
  entry: GroupedEntry,
  message: MessageListItem,
  isStreaming: boolean,
  isTranslationOverlayActive: boolean,
  options?: RenderGroupedEntryOptions
): React.ReactNode {
  const enableAnimation = options?.enableAnimation ?? isStreaming

  if (Array.isArray(entry)) {
    const groupKey = entry.map((e) => `${message.id}-part-${e.index}`).join('-')
    const firstPart = entry[0].part

    if (isImageFilePart(firstPart)) {
      const images = entry.map((e) => extractImageUrl(e.part)).filter(Boolean) as string[]
      if (images.length === 0) return null

      if (images.length === 1) {
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={enableAnimation}>
            <ImageBlock images={images} isSingle={true} />
          </AnimatedBlockWrapper>
        )
      }
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={enableAnimation}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxWidth: '100%' }}>
            {images.map((src, i) => (
              <ImageBlock key={`${groupKey}-img-${i}`} images={[src]} isSingle={false} />
            ))}
          </div>
        </AnimatedBlockWrapper>
      )
    }

    if (isToolUIPart(firstPart)) {
      const toolItems = buildToolRenderItems(entry, message.id, options?.settleActiveTools)
      if (toolItems.length === 0) return null

      const stableGroupKey = `tool-group-${message.id}-part-${entry[0].index}`
      return (
        <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={enableAnimation} animation="fade">
          <ToolBlockGroupContent items={toolItems} />
        </AnimatedBlockWrapper>
      )
    }

    if (isDataUIPart(firstPart) && firstPart.type === 'data-video') {
      const firstEntry = entry[0]
      const partId = `${message.id}-part-${firstEntry.index}`
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={enableAnimation}>
          {renderPart(firstEntry.part, partId, message, isStreaming, isTranslationOverlayActive)}
        </AnimatedBlockWrapper>
      )
    }

    return null
  }

  const partId = `${message.id}-part-${entry.index}`
  const rendered = renderPart(entry.part, partId, message, isStreaming, isTranslationOverlayActive, options)
  if (!rendered) return null

  return (
    <AnimatedBlockWrapper
      key={partId}
      enableAnimation={enableAnimation}
      className={isReasoningMessagePart(entry.part) ? 'message-thought-wrapper' : undefined}>
      {rendered}
    </AnimatedBlockWrapper>
  )
}

function filterToolHistoryReasoningEntries(
  entries: readonly PartEntry[],
  keepLastReasoning: boolean
): readonly PartEntry[] {
  const reasoningCount = entries.reduce((count, entry) => count + (isReasoningMessagePart(entry.part) ? 1 : 0), 0)
  if (reasoningCount <= TOOL_HISTORY_REASONING_DISPLAY_LIMIT) return entries
  let lastReasoningEntry: PartEntry | undefined
  if (keepLastReasoning) {
    for (let index = entries.length - 1; index >= 0; index--) {
      if (isReasoningMessagePart(entries[index].part)) {
        lastReasoningEntry = entries[index]
        break
      }
    }
  }
  return entries.filter((entry) => !isReasoningMessagePart(entry.part) || entry === lastReasoningEntry)
}

type LiveRenderItem =
  | LiveMessagePartLayoutItem
  | {
      kind: 'content'
      key: number
      entry: GroupedEntry
    }

function groupLiveLayoutItems(items: readonly LiveMessagePartLayoutItem[]): LiveRenderItem[] {
  const result: LiveRenderItem[] = []
  let contentEntries: PartEntry[] = []

  const flushContent = () => {
    for (const entry of groupPartEntries(contentEntries)) {
      const firstEntry = Array.isArray(entry) ? entry[0] : entry
      result.push({ kind: 'content', key: firstEntry.index, entry })
    }
    contentEntries = []
  }

  for (const item of items) {
    if (item.kind === 'part') {
      if (isToolUIPart(item.entry.part)) {
        flushContent()
        result.push({ kind: 'content', key: item.key, entry: item.entry })
        continue
      }
      contentEntries.push(item.entry)
      continue
    }

    flushContent()
    result.push(item)
  }

  flushContent()
  return result
}

function hasVisibleReasoning(entries: readonly PartEntry[]): boolean {
  return entries.some((entry) => isReasoningMessagePart(entry.part))
}

function hasReasoningTail(entries: readonly PartEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const part = entries[index].part
    const partType = part.type as string
    if (
      partType === 'step-start' ||
      partType === 'source-url' ||
      partType === 'source-document' ||
      partType === 'data-citation' ||
      partType === 'data-agent-task-event'
    ) {
      continue
    }
    return partType === 'reasoning'
  }
  return false
}

interface LiveProcessSummary {
  allToolsTerminal: boolean
  hasToolError: boolean
  hasReasoning: boolean
  headerToolItems: ToolRenderItem[]
  toolCount: number
}

function buildLiveProcessSummary(entries: readonly PartEntry[], messageId: string): LiveProcessSummary {
  let allToolsTerminal = true
  let hasReasoning = false
  let lastActiveItem: ToolRenderItem | undefined
  let lastItem: ToolRenderItem | undefined
  let lastErrorItem: ToolRenderItem | undefined
  let lastWaitingItem: ToolRenderItem | undefined
  let toolCount = 0

  for (const entry of entries) {
    if (isReasoningMessagePart(entry.part)) hasReasoning = true
    if (!isToolUIPart(entry.part)) continue

    const item = getCachedToolProjection(entry.part, `${messageId}-part-${entry.index}`).renderItem
    if (!item) continue

    toolCount++
    lastItem = item
    if (item.toolResponse.status === 'error' || item.toolResponse.response?.isError === true) {
      lastErrorItem = item
    }
    if (!['done', 'error', 'cancelled'].includes(item.toolResponse.status)) {
      allToolsTerminal = false
      lastActiveItem = item
    }
    if ((entry.part as { state?: string }).state === 'approval-requested') {
      lastWaitingItem = item
    }
  }

  const headerItem = lastWaitingItem ?? lastErrorItem ?? lastActiveItem ?? lastItem
  return {
    allToolsTerminal,
    hasToolError: lastErrorItem !== undefined,
    hasReasoning,
    headerToolItems: headerItem ? [headerItem] : [],
    toolCount
  }
}

function isApprovalGatedToolPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part)) return false
  const toolPart = part as { approval?: { id?: string }; state?: string }
  return !!toolPart.approval?.id || toolPart.state === 'approval-requested' || toolPart.state === 'approval-responded'
}

function arePartEntriesEqual(previous: readonly PartEntry[], next: readonly PartEntry[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((entry, index) => entry.index === next[index].index && entry.part === next[index].part)
  )
}

const LiveProcessRunView = React.memo(
  function LiveProcessRunView({
    entries,
    isExpanded,
    isLastItem,
    isStreamLive,
    message,
    onExpandedChange
  }: {
    entries: readonly PartEntry[]
    isExpanded: boolean
    isLastItem: boolean
    isStreamLive: boolean
    message: MessageListItem
    onExpandedChange: (expanded: boolean) => void
  }) {
    const [expandedToolId, setExpandedToolId] = React.useState<string | null>(null)
    const summary = useMemo(() => buildLiveProcessSummary(entries, message.id), [entries, message.id])
    const isLive = isStreamLive && isLastItem
    const groupedEntries = useMemo(() => (isExpanded ? groupPartEntries(entries) : []), [entries, isExpanded])

    React.useEffect(() => {
      if (!isExpanded) setExpandedToolId(null)
    }, [isExpanded])

    const renderContent = React.useCallback(
      (onBeforeExpand: () => void, onAfterCollapse: () => void) =>
        groupedEntries.map((entry) => {
          if (Array.isArray(entry) && isToolUIPart(entry[0].part)) {
            const items = buildToolRenderItems(entry, message.id)
            if (items.length === 0) return null
            return (
              <LiveProcessToolList
                key={`live-tool-list-${message.id}-${entry[0].index}`}
                items={items}
                onAfterCollapse={onAfterCollapse}
                onBeforeExpand={onBeforeExpand}
                expandedToolId={expandedToolId}
                onExpandedToolIdChange={setExpandedToolId}
              />
            )
          }

          return renderGroupedEntry(entry, message, false, false, {
            enableAnimation: false,
            reasoningDisplay: 'content',
            settleStreamingReasoning: !isStreamLive
          })
        }),
      [expandedToolId, groupedEntries, isStreamLive, message]
    )

    if (!summary.hasReasoning && summary.toolCount === 0) return null

    return (
      <LiveProcessRun
        id={`${message.id}-process-${entries.find((entry) => isReasoningMessagePart(entry.part) || isToolUIPart(entry.part))?.index ?? entries[0].index}`}
        allToolsTerminal={summary.allToolsTerminal}
        hasReasoning={summary.hasReasoning}
        headerToolItems={summary.headerToolItems}
        hasToolError={summary.hasToolError}
        isExpanded={isExpanded}
        isLive={isLive}
        isReasoningTail={hasReasoningTail(entries)}
        onExpandedChange={onExpandedChange}
        renderContent={renderContent}
        toolCount={summary.toolCount}
      />
    )
  },
  (previous, next) =>
    previous.isExpanded === next.isExpanded &&
    previous.isLastItem === next.isLastItem &&
    previous.isStreamLive === next.isStreamLive &&
    previous.message.id === next.message.id &&
    arePartEntriesEqual(previous.entries, next.entries)
)

function areGroupedEntriesEqual(previous: GroupedEntry, next: GroupedEntry): boolean {
  if (Array.isArray(previous) !== Array.isArray(next)) return false
  if (!Array.isArray(previous) || !Array.isArray(next)) {
    return !Array.isArray(previous) && !Array.isArray(next) && arePartEntriesEqual([previous], [next])
  }
  return arePartEntriesEqual(previous, next)
}

const MessageContentEntryView = React.memo(
  function MessageContentEntryView({
    enableAnimation,
    entry,
    isStreaming,
    isTranslationOverlayActive,
    message,
    renderOptions
  }: {
    enableAnimation: boolean
    entry: GroupedEntry
    isStreaming: boolean
    isTranslationOverlayActive: boolean
    message: MessageListItem
    renderOptions: RenderGroupedEntryOptions
  }) {
    return renderGroupedEntry(entry, message, isStreaming, isTranslationOverlayActive, {
      ...renderOptions,
      enableAnimation
    })
  },
  (previous, next) =>
    previous.enableAnimation === next.enableAnimation &&
    previous.isStreaming === next.isStreaming &&
    previous.isTranslationOverlayActive === next.isTranslationOverlayActive &&
    previous.message.id === next.message.id &&
    previous.message.role === next.message.role &&
    previous.message.createdAt === next.message.createdAt &&
    previous.message.modelId === next.message.modelId &&
    previous.message.modelSnapshot === next.message.modelSnapshot &&
    previous.renderOptions === next.renderOptions &&
    areGroupedEntriesEqual(previous.entry, next.entry)
)

/**
 * Stable shell shared by active and terminal projections. The projections stay
 * separate, but a final text leaf keeps the same keyed component across the
 * terminal frame so markdown selection, focus, and local block state survive.
 */
const MessageProcessLayout = React.memo(function MessageProcessLayout({
  collapseHistory,
  entries,
  isActive,
  isStreamLive,
  isTranslationOverlayActive,
  message,
  renderOptions
}: {
  collapseHistory: boolean
  entries: readonly PartEntry[]
  isActive: boolean
  isStreamLive: boolean
  isTranslationOverlayActive: boolean
  message: MessageListItem
  renderOptions: RenderGroupedEntryOptions
}) {
  const [expandedRunKey, setExpandedRunKey] = React.useState<number | null>(null)
  const approvalToolCallIdsRef = React.useRef(new Set<string>())
  if (isActive) {
    for (const entry of entries) {
      if (isApprovalGatedToolPart(entry.part) && isToolUIPart(entry.part)) {
        approvalToolCallIdsRef.current.add(entry.part.toolCallId)
      }
    }
  }

  const projectedLiveItems = useMemo(
    () =>
      isActive
        ? projectLiveMessageParts(entries, approvalToolCallIdsRef.current).filter(
            (item) => item.kind !== 'part' || !isReportArtifactEntry(item.entry, message.id)
          )
        : [],
    [entries, isActive, message.id]
  )
  const liveItems = useMemo(() => groupLiveLayoutItems(projectedLiveItems), [projectedLiveItems])
  const openTextTailIndex = isActive && isStreamLive ? findOpenTextTailIndex(entries) : null

  const completedLayout = useMemo(() => (isActive ? null : projectCompletedMessageParts(entries)), [entries, isActive])
  const completedFlatEntries = useMemo(() => {
    if (!completedLayout) return []
    const projectedIndexes = new Set(
      [...completedLayout.historyEntries, ...completedLayout.resultEntries].map((entry) => entry.index)
    )
    return entries.filter((entry) => projectedIndexes.has(entry.index))
  }, [completedLayout, entries])
  const rawHistoryEntries = completedLayout?.historyEntries ?? EMPTY_PART_ENTRIES
  const historyToolItems = useMemo(
    () => buildToolRenderItems(rawHistoryEntries, message.id, true),
    [message.id, rawHistoryEntries]
  )
  const historyToolCount = useMemo(
    () => rawHistoryEntries.reduce((count, entry) => count + (isToolUIPart(entry.part) ? 1 : 0), 0),
    [rawHistoryEntries]
  )
  const historyHasError = useMemo(
    () =>
      rawHistoryEntries.some((entry) => {
        if ((entry.part.type as string) === 'data-error') return true
        if (!isToolUIPart(entry.part)) return false
        const toolResponse = getCachedToolProjection(entry.part, `${message.id}-part-${entry.index}`).toolResponse
        return toolResponse?.status === 'error' || toolResponse?.response?.isError === true
      }),
    [message.id, rawHistoryEntries]
  )
  const historyHasReasoning = hasVisibleReasoning(rawHistoryEntries)
  const historyEntries = useMemo(
    () => filterToolHistoryReasoningEntries(rawHistoryEntries, historyToolItems.length === 0),
    [historyToolItems.length, rawHistoryEntries]
  )
  const historyHasContent = useMemo(
    () => historyEntries.some((entry) => isPotentiallyVisibleEntry(entry, message.id)),
    [historyEntries, message.id]
  )
  const hasHistory = !isActive && collapseHistory && historyHasContent
  const historyGroups = useMemo(() => groupPartEntries(historyEntries), [historyEntries])
  const visibleEntries = useMemo(
    () => (completedLayout ? (hasHistory ? completedLayout.resultEntries : completedFlatEntries) : EMPTY_PART_ENTRIES),
    [completedFlatEntries, completedLayout, hasHistory]
  )
  const visibleGroups = useMemo(() => groupPartEntries(visibleEntries), [visibleEntries])
  const completedRenderOptions = useMemo(
    () => ({ ...renderOptions, settleActiveTools: true, settleStreamingReasoning: true }),
    [renderOptions]
  )

  if (isActive) {
    return (
      <>
        {liveItems.map((item, itemIndex) => {
          if (item.kind === 'process') {
            const isExpanded = expandedRunKey === item.key
            return (
              <AnimatedBlockWrapper
                key={`live-process-${message.id}-${item.key}`}
                enableAnimation={isStreamLive && itemIndex === liveItems.length - 1}
                animation="fade">
                <LiveProcessRunView
                  entries={item.entries}
                  isExpanded={isExpanded}
                  isLastItem={itemIndex === liveItems.length - 1}
                  isStreamLive={isStreamLive}
                  message={message}
                  onExpandedChange={(expanded) => setExpandedRunKey(expanded ? item.key : null)}
                />
              </AnimatedBlockWrapper>
            )
          }

          const entryIndexes = Array.isArray(item.entry) ? item.entry.map((entry) => entry.index) : [item.entry.index]
          const streamsTextTail = openTextTailIndex !== null && entryIndexes.includes(openTextTailIndex)
          return (
            <MessageContentEntryView
              key={`message-content-${message.id}-${item.key}`}
              enableAnimation={isStreamLive}
              entry={item.entry}
              isStreaming={streamsTextTail}
              isTranslationOverlayActive={isTranslationOverlayActive}
              message={message}
              renderOptions={renderOptions}
            />
          )
        })}
      </>
    )
  }

  const completedItems: React.ReactNode[] = visibleGroups.map((entry) => {
    const firstEntry = Array.isArray(entry) ? entry[0] : entry
    return (
      <MessageContentEntryView
        key={`message-content-${message.id}-${firstEntry.index}`}
        enableAnimation={false}
        entry={entry}
        isStreaming={false}
        isTranslationOverlayActive={isTranslationOverlayActive}
        message={message}
        renderOptions={completedRenderOptions}
      />
    )
  })

  if (hasHistory) {
    completedItems.unshift(
      <AnimatedBlockWrapper key={`tool-history-${message.id}`} enableAnimation={false}>
        <CompletedProcessHistory
          hasContent={historyHasContent}
          hasError={historyHasError}
          hasReasoning={historyHasReasoning}
          message={message}
          toolCount={historyToolCount}
          toolItems={historyToolItems}>
          {historyGroups.map((entry) => renderGroupedEntry(entry, message, false, false, completedRenderOptions))}
        </CompletedProcessHistory>
      </AnimatedBlockWrapper>
    )
  }

  // Keep keyed content in the same child-array slot across the active-to-terminal frame.
  return <>{completedItems}</>
})

// ============================================================================
// Main component
// ============================================================================

interface MessagePartsRendererContentProps extends Props {
  collapseCompletedToolHistory: boolean
  isActiveTurnProcessing: boolean
  isStreamLive: boolean
  isTranslationOverlayActive: boolean
  messageParts: CherryMessagePart[]
}

const MessagePartsRendererContent = React.memo(function MessagePartsRendererContent({
  collapseCompletedToolHistory,
  isActiveTurnProcessing,
  isStreamLive,
  isTranslationOverlayActive,
  message,
  messageParts
}: MessagePartsRendererContentProps) {
  const requestFollowRecovery = useRequestScrollFollowRecovery()
  const wasActiveTurnProcessingRef = React.useRef(isActiveTurnProcessing)
  React.useEffect(() => {
    if (wasActiveTurnProcessingRef.current && !isActiveTurnProcessing) requestFollowRecovery()
    wasActiveTurnProcessingRef.current = isActiveTurnProcessing
  }, [isActiveTurnProcessing, requestFollowRecovery])
  const [expandedTextPartIds, setExpandedTextPartIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const handleTextPartExpandedChange = React.useCallback((partId: string, expanded: boolean) => {
    setExpandedTextPartIds((current) => {
      const hasPartId = current.has(partId)
      if (hasPartId === expanded) return current

      const next = new Set(current)
      if (expanded) {
        next.add(partId)
      } else {
        next.delete(partId)
      }
      return next
    })
  }, [])

  const partEntries = useMemo(
    () => messageParts.flatMap((part, index) => (hasPartParentToolCallId(part) ? [] : [{ part, index }])),
    [messageParts]
  )
  const placeholderStatus = useMemo(() => getProcessingPlaceholderStatus(partEntries), [partEntries])
  const nextReportArtifactToolResponses = useMemo(
    () => getReportArtifactToolResponses(partEntries, message.id),
    [partEntries, message.id]
  )
  const reportArtifactToolResponses = useStableItemArray(nextReportArtifactToolResponses)
  const visibleComposerFileTokens = useMemo(
    () => getVisibleComposerFileTokens(messageParts, message, expandedTextPartIds),
    [expandedTextPartIds, message, messageParts]
  )
  const displayEntries = useMemo(
    () => getDisplayEntries(partEntries, message, visibleComposerFileTokens),
    [message, partEntries, visibleComposerFileTokens]
  )
  const hasVisibleEntry = useMemo(
    () => displayEntries.some((entry) => isPotentiallyVisibleEntry(entry, message.id)),
    [displayEntries, message.id]
  )
  const renderOptions = useMemo(
    () => ({
      expandedTextPartIds,
      onTextPartExpandedChange: handleTextPartExpandedChange
    }),
    [expandedTextPartIds, handleTextPartExpandedChange]
  )

  // No parts to render — normal for user messages (content is in message text, not parts)
  // But if the message is processing (pending/streaming), show the loading placeholder
  if (partEntries.length === 0 || (!hasVisibleEntry && reportArtifactToolResponses.length === 0)) {
    if (isActiveTurnProcessing) {
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
      <MessageProcessLayout
        key={`process-layout-${message.id}`}
        collapseHistory={collapseCompletedToolHistory}
        entries={displayEntries}
        isActive={isActiveTurnProcessing}
        isStreamLive={isStreamLive}
        isTranslationOverlayActive={isTranslationOverlayActive}
        message={message}
        renderOptions={renderOptions}
      />
      {reportArtifactToolResponses.length > 0 && (
        <AnimatedBlockWrapper key={`report-artifacts-${message.id}`} enableAnimation={isStreamLive} animation="fade">
          <MessageReportArtifacts toolResponses={reportArtifactToolResponses} />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
})

const MessagePartsRenderer: React.FC<Props> = ({ message }) => {
  const messageParts = useMessageParts(message.id)
  const { status: topicStreamStatus } = useTopicStreamStatus(message.topicId)
  const topicTurnState = classifyTurn(topicStreamStatus)
  const isProcessing = useIsActiveTurnTarget(message)
  const isActiveTurnProcessing = isProcessing && (topicStreamStatus === undefined || topicTurnState.isTurnActive)
  const isStreamLive =
    isActiveTurnProcessing &&
    (topicStreamStatus === undefined ? message.status === 'pending' : topicTurnState.isStreamLive)
  const isTranslationOverlayActive = useTranslationOverlayEntry(message.id) !== undefined
  const { collapseCompletedToolHistory } = useMessageRenderConfig()

  return (
    <MessagePartsRendererContent
      collapseCompletedToolHistory={collapseCompletedToolHistory}
      isActiveTurnProcessing={isActiveTurnProcessing}
      isStreamLive={isStreamLive}
      isTranslationOverlayActive={isTranslationOverlayActive}
      message={message}
      messageParts={messageParts}
    />
  )
}

export default React.memo(MessagePartsRenderer)
