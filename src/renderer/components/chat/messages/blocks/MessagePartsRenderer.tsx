/**
 * MessagePartsRenderer — message parts renderer.
 *
 * Routes CherryMessagePart[] directly to leaf components. No intermediate
 * block conversion — each part type is rendered from its raw data.
 *
 * Active and terminal messages use separate projections. Process narration,
 * reasoning, and child tool groups share one top-level disclosure while the
 * current or final substantive answer stays outside it.
 *
 * Within a segment, grouping logic:
 * - Consecutive file parts with image mediaType → image block row
 * - Consecutive tool-* / dynamic-tool parts → nested ToolBlockGroup row
 * - data-video parts with same filePath → video block row
 */

import { loggerService } from '@logger'
import type { ReadOnlyComposerFileTokenPreview } from '@renderer/components/composer/tokenView'
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
import ErrorBlock from './ErrorBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock, { buildUserMessagePreview } from './MainTextBlock'
import {
  findOpenTextTailIndex,
  isHiddenPart,
  isReasoningMessagePart,
  isResultPart,
  isSubstantiveAnswerPart,
  type LiveMessagePartLayoutItem,
  type PartEntry,
  projectCompletedMessageParts,
  projectLiveMessageParts
} from './messagePartLayouts'
import { useMessageParts, useTranslationOverlayEntry } from './MessagePartsContext'
import MessageProcessGroup from './MessageProcessGroup'
import PlaceholderBlock, { type PlaceholderStatus } from './PlaceholderBlock'
import { useRequestScrollFollowRecovery } from './ScrollOwnershipContext'
import ThinkingBlock, { ThinkingBlockContent } from './ThinkingBlock'
import { ToolBlockGroup, ToolBlockGroupContent } from './ToolBlockGroup'
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

type GroupedEntry = PartEntry | PartEntry[]

interface RenderGroupedEntryOptions {
  enableAnimation?: boolean
  expandedTextPartIds?: ReadonlySet<string>
  readOnlyFilePreviews?: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
  onTextPartExpandedChange?: (partId: string, expanded: boolean) => void
  reasoningDisplay?: 'content' | 'disclosure'
  settleActiveTools?: boolean
  settleStreamingReasoning?: boolean
  toolDisplay?: 'content' | 'disclosure'
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

function getReadOnlyFileTokenPreviews(
  parts: readonly CherryMessagePart[]
): ReadonlyMap<string, ReadOnlyComposerFileTokenPreview> {
  const previews = new Map<string, ReadOnlyComposerFileTokenPreview>()

  for (const part of parts) {
    if (!isFileUIPart(part)) continue

    const cherryMeta = getCherryMeta(part)
    const sourceId = cherryMeta?.fileTokenSourceId
    if (!sourceId) continue

    previews.set(sourceId, {
      url: part.url,
      mediaType: part.mediaType,
      ...(cherryMeta.composerFileKind && { composerFileKind: cherryMeta.composerFileKind })
    })
  }

  return previews
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

  if (isHiddenPart(part)) return false
  if (partType === 'reasoning') return isReasoningMessagePart(part)
  if (
    partType === 'text' ||
    partType === 'data-code' ||
    partType === 'data-compact' ||
    partType === 'data-translation'
  ) {
    return isSubstantiveAnswerPart(part)
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
          readOnlyFilePreviews={options?.readOnlyFilePreviews}
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

function areReadOnlyFilePreviewsEqual(
  previous: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>,
  next: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
): boolean {
  if (previous.size !== next.size) return false
  for (const [key, prev] of previous) {
    const current = next.get(key)
    if (
      !current ||
      current.url !== prev.url ||
      current.mediaType !== prev.mediaType ||
      current.composerFileKind !== prev.composerFileKind
    ) {
      return false
    }
  }
  return true
}

// Keeps the preview map identity stable across streaming ticks so render memoization holds when file tokens are unchanged.
function useStableReadOnlyFilePreviews(
  previews: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
): ReadonlyMap<string, ReadOnlyComposerFileTokenPreview> {
  const stableRef = React.useRef(previews)
  if (!areReadOnlyFilePreviewsEqual(stableRef.current, previews)) {
    stableRef.current = previews
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
          {options?.toolDisplay === 'disclosure' ? (
            <ToolBlockGroup items={toolItems} />
          ) : (
            <ToolBlockGroupContent items={toolItems} />
          )}
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

function findLastLiveToolBoundaryIndex(items: readonly LiveMessagePartLayoutItem[]): number {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    const entries = item.kind === 'process' ? item.entries : [item.entry]
    if (entries.some(({ part }) => isToolUIPart(part) && !isAskUserQuestionToolName(getToolName(part)))) {
      return index
    }
  }
  return -1
}

type NestedHistoryItem =
  | { kind: 'process'; key: number; entries: PartEntry[] }
  | { kind: 'content'; key: number; entry: GroupedEntry }

function groupNestedHistoryEntries(entries: readonly PartEntry[]): NestedHistoryItem[] {
  const result: NestedHistoryItem[] = []
  let contentEntries: PartEntry[] = []
  let processEntries: PartEntry[] = []

  const flushContent = () => {
    for (const entry of groupPartEntries(contentEntries)) {
      const firstEntry = Array.isArray(entry) ? entry[0] : entry
      result.push({ kind: 'content', key: firstEntry.index, entry })
    }
    contentEntries = []
  }

  const flushProcess = () => {
    if (processEntries.length > 0) {
      result.push({ kind: 'process', key: processEntries[0].index, entries: processEntries })
    }
    processEntries = []
  }

  for (const entry of entries) {
    if (isHiddenPart(entry.part)) continue

    if ((entry.part.type as string) === 'reasoning' || isToolUIPart(entry.part)) {
      flushContent()
      processEntries.push(entry)
    } else {
      flushProcess()
      contentEntries.push(entry)
    }
  }

  flushProcess()
  flushContent()
  return result
}

function renderNestedHistory(
  entries: readonly PartEntry[],
  message: MessageListItem,
  isTranslationOverlayActive: boolean,
  options: RenderGroupedEntryOptions,
  liveProcessMode?: 'last' | 'settled'
): React.ReactNode {
  const nestedItems = groupNestedHistoryEntries(entries)
  let lastProcessIndex = -1
  if (liveProcessMode === 'last') {
    for (let index = nestedItems.length - 1; index >= 0; index--) {
      if (nestedItems[index].kind === 'process') {
        lastProcessIndex = index
        break
      }
    }
  }

  return nestedItems.map((item, itemIndex) => {
    if (item.kind === 'content') {
      return renderGroupedEntry(item.entry, message, false, isTranslationOverlayActive, options)
    }

    if (options.toolDisplay !== 'disclosure') {
      return (
        <React.Fragment key={`process-${message.id}-${item.key}`}>
          {groupPartEntries(item.entries).map((entry) =>
            renderGroupedEntry(entry, message, false, isTranslationOverlayActive, options)
          )}
        </React.Fragment>
      )
    }

    const toolItems = buildToolRenderItems(item.entries, message.id, options.settleActiveTools)
    if (toolItems.length === 0) {
      return (
        <React.Fragment key={`reasoning-${message.id}-${item.key}`}>
          {groupPartEntries(item.entries).map((entry) =>
            renderGroupedEntry(entry, message, false, isTranslationOverlayActive, {
              ...options,
              enableAnimation: false,
              reasoningDisplay: 'disclosure'
            })
          )}
        </React.Fragment>
      )
    }

    const isCurrentProcess = itemIndex === lastProcessIndex
    const isLiveProgress =
      liveProcessMode === 'settled' ? false : liveProcessMode === 'last' ? isCurrentProcess : undefined
    const lastProcessEntry = item.entries.at(-1)
    const isThinking =
      isCurrentProcess &&
      lastProcessEntry !== undefined &&
      (lastProcessEntry.part.type as string) === 'reasoning' &&
      (lastProcessEntry.part as ReasoningUIPart).state === 'streaming'

    return (
      <AnimatedBlockWrapper key={`nested-process-${message.id}-${item.key}`} enableAnimation={false} animation="fade">
        <ToolBlockGroup items={toolItems} isLiveProgress={isLiveProgress} isThinking={isThinking}>
          <div className="flex w-full flex-col gap-1 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!">
            {groupPartEntries(item.entries).map((entry) =>
              renderGroupedEntry(entry, message, false, isTranslationOverlayActive, {
                ...options,
                enableAnimation: false,
                reasoningDisplay: 'disclosure',
                toolDisplay: 'content'
              })
            )}
          </div>
        </ToolBlockGroup>
      </AnimatedBlockWrapper>
    )
  })
}

function arePartEntriesEqual(previous: readonly PartEntry[], next: readonly PartEntry[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((entry, index) => entry.index === next[index].index && entry.part === next[index].part)
  )
}

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
    previous.message.model === next.message.model &&
    previous.renderOptions === next.renderOptions &&
    areGroupedEntriesEqual(previous.entry, next.entry)
)

const ActiveMessageProcess = React.memo(
  function ActiveMessageProcess({
    entries,
    hasResultContent,
    isStreamLive,
    isTranslationOverlayActive,
    message,
    renderOptions
  }: {
    entries: readonly PartEntry[]
    hasResultContent: boolean
    isStreamLive: boolean
    isTranslationOverlayActive: boolean
    message: MessageListItem
    renderOptions: RenderGroupedEntryOptions
  }) {
    const toolItems = useMemo(() => buildToolRenderItems(entries, message.id), [entries, message.id])
    const renderHistory = React.useCallback(
      (isExpanded: boolean) => {
        if (!isExpanded) return null

        return renderNestedHistory(
          entries,
          message,
          isTranslationOverlayActive,
          {
            ...renderOptions,
            enableAnimation: false,
            settleStreamingReasoning: !isStreamLive,
            toolDisplay: 'disclosure'
          },
          hasResultContent ? 'settled' : 'last'
        )
      },
      [entries, hasResultContent, isStreamLive, isTranslationOverlayActive, message, renderOptions]
    )

    return (
      <MessageProcessGroup phase="active" message={message} toolItems={toolItems}>
        {renderHistory}
      </MessageProcessGroup>
    )
  },
  (previous, next) =>
    previous.hasResultContent === next.hasResultContent &&
    previous.isStreamLive === next.isStreamLive &&
    previous.isTranslationOverlayActive === next.isTranslationOverlayActive &&
    previous.message.id === next.message.id &&
    previous.message.role === next.message.role &&
    previous.message.createdAt === next.message.createdAt &&
    previous.message.modelId === next.message.modelId &&
    previous.message.model === next.message.model &&
    previous.renderOptions === next.renderOptions &&
    arePartEntriesEqual(previous.entries, next.entries)
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
  const projectedLiveItems = useMemo(
    () =>
      isActive
        ? projectLiveMessageParts(entries).filter(
            (item) => item.kind !== 'part' || !isReportArtifactEntry(item.entry, message.id)
          )
        : [],
    [entries, isActive, message.id]
  )
  const liveToolBoundary = useMemo(() => findLastLiveToolBoundaryIndex(projectedLiveItems), [projectedLiveItems])
  const { liveHistoryItems, liveResultItems } = useMemo(() => {
    const historyItems: LiveMessagePartLayoutItem[] = []
    const resultItems: LiveMessagePartLayoutItem[] = []

    projectedLiveItems.forEach((item, index) => {
      if (index <= liveToolBoundary || item.kind === 'process') {
        historyItems.push(item)
      } else {
        resultItems.push(item)
      }
    })

    return { liveHistoryItems: historyItems, liveResultItems: resultItems }
  }, [liveToolBoundary, projectedLiveItems])
  const liveHistoryEntries = useMemo(
    () => liveHistoryItems.flatMap((item) => (item.kind === 'process' ? item.entries : [item.entry])),
    [liveHistoryItems]
  )
  const openTextTailIndex = isActive && isStreamLive ? findOpenTextTailIndex(entries) : null

  const completedLayout = useMemo(() => (isActive ? null : projectCompletedMessageParts(entries)), [entries, isActive])
  const completedRenderOptions = useMemo(
    () => ({ ...renderOptions, settleActiveTools: true, settleStreamingReasoning: true }),
    [renderOptions]
  )

  if (isActive) {
    const resultContent = liveResultItems.map((item) => {
      if (item.kind === 'process') return null

      return (
        <MessageContentEntryView
          key={`message-content-${message.id}-${item.key}`}
          enableAnimation={isStreamLive}
          entry={item.entry}
          isStreaming={openTextTailIndex === item.entry.index}
          isTranslationOverlayActive={isTranslationOverlayActive}
          message={message}
          renderOptions={renderOptions}
        />
      )
    })

    if (liveHistoryEntries.length === 0) return <>{resultContent}</>

    return (
      <>
        <ActiveMessageProcess
          entries={liveHistoryEntries}
          hasResultContent={liveResultItems.length > 0}
          isStreamLive={isStreamLive}
          isTranslationOverlayActive={isTranslationOverlayActive}
          message={message}
          renderOptions={renderOptions}
        />
        {resultContent}
      </>
    )
  }

  if (!completedLayout) return null

  const completedHistoryEntries = completedLayout.historyEntries

  const renderCompletedHistory = (isExpanded: boolean) =>
    isExpanded
      ? renderNestedHistory(
          completedHistoryEntries,
          message,
          isTranslationOverlayActive,
          collapseHistory
            ? {
                ...completedRenderOptions,
                reasoningDisplay: 'content',
                toolDisplay: 'disclosure'
              }
            : {
                ...completedRenderOptions,
                reasoningDisplay: 'disclosure',
                toolDisplay: 'content'
              }
        )
      : null
  const completedResult = groupPartEntries(completedLayout.resultEntries).map((entry) => {
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

  const hasVisibleCompletedHistory = completedHistoryEntries.some((entry) =>
    isPotentiallyVisibleEntry(entry, message.id)
  )
  if (!hasVisibleCompletedHistory) return <>{completedResult}</>

  if (!collapseHistory) {
    return (
      <>
        {renderCompletedHistory(true)}
        {completedResult}
      </>
    )
  }

  const completedToolItems = buildToolRenderItems(completedHistoryEntries, message.id, true)
  const completedHasError = (() => {
    const historyHasError = completedHistoryEntries.some((entry) => {
      if ((entry.part.type as string) === 'data-error') return true
      if (!isToolUIPart(entry.part)) return false

      const toolResponse = getCachedToolProjection(entry.part, `${message.id}-part-${entry.index}`).toolResponse
      return toolResponse?.status === 'error' || toolResponse?.response?.isError === true
    })
    const projectedIndexes = new Set(
      [...completedHistoryEntries, ...completedLayout.resultEntries].map((entry) => entry.index)
    )

    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      if (!projectedIndexes.has(entry.index) || !isPotentiallyVisibleEntry(entry, message.id)) continue
      if (isReasoningMessagePart(entry.part)) continue
      if ((entry.part.type as string) === 'data-error') return true
      if (!isToolUIPart(entry.part)) return false

      const toolResponse = getCachedToolProjection(entry.part, `${message.id}-part-${entry.index}`).toolResponse
      return toolResponse?.status === 'error' || toolResponse?.response?.isError === true
    }

    return historyHasError
  })()

  return (
    <>
      <MessageProcessGroup
        key={`completed-process-${message.id}-${message.status}-${message.updatedAt ?? ''}`}
        phase="completed"
        outcome={completedHasError ? 'error' : 'success'}
        message={message}
        toolItems={completedToolItems}>
        {renderCompletedHistory}
      </MessageProcessGroup>
      {completedResult}
    </>
  )
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
  const nextReadOnlyFilePreviews = useMemo(() => getReadOnlyFileTokenPreviews(messageParts), [messageParts])
  const readOnlyFilePreviews = useStableReadOnlyFilePreviews(nextReadOnlyFilePreviews)
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
      readOnlyFilePreviews,
      onTextPartExpandedChange: handleTextPartExpandedChange
    }),
    [expandedTextPartIds, handleTextPartExpandedChange, readOnlyFilePreviews]
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
