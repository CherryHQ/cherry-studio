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
import { readComposerFileTokenIdSuffix } from '@renderer/utils/message/composerFileTokenSource'
import { getDisplayComposerTokens } from '@renderer/utils/message/composerTokens'
import { convertReferencesToCitationReferences, convertReferencesToCitations } from '@renderer/utils/partsToBlocks'
import { classifyTurn } from '@shared/ai/transport'
import type { CherryMessagePart, ContentReference, ReasoningUIPart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ComposerMessageToken, ErrorPartData } from '@shared/data/types/uiParts'
import { isDataUIPart, isFileUIPart, isToolUIPart } from 'ai'
import { X } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import MessageAttachments from '../frame/MessageAttachments'
import MessageVideo from '../frame/MessageVideo'
import { useMessageRenderConfig } from '../MessageListProvider'
import { isReportArtifactsToolResponse, MessageReportArtifacts } from '../tools/agent'
import MessageTools, { canRenderMessageTool } from '../tools/MessageTools'
import { isAskUserQuestionToolName } from '../tools/shared/agentToolTypes'
import { hasPartParentToolCallId } from '../tools/toolParentMetadata'
import { buildToolResponseFromPart, type ToolRenderItem } from '../tools/toolResponse'
import type { MessageListItem } from '../types'
import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import CompactionAnchorBlock from './CompactionAnchorBlock'
import ErrorBlock from './ErrorBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock, { buildUserMessagePreview } from './MainTextBlock'
import { useMessageParts, useTranslationOverlayEntry } from './MessagePartsContext'
import PlaceholderBlock, {
  formatPlaceholderElapsed,
  type PlaceholderStatus,
  usePlaceholderElapsedMs
} from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import { ToolBlockGroupContent, ToolBlockGroupHeaderContent } from './ToolBlockGroup'
import TranslationBlock from './TranslationBlock'

const logger = loggerService.withContext('MessagePartsRenderer')
const BOTTOM_COLLAPSE_TOOL_COUNT_THRESHOLD = 10
const TOOL_HISTORY_PREVIEW_ENTRY_LIMIT = 10
const TOOL_HISTORY_REASONING_DISPLAY_LIMIT = 3
const TRAILING_RESULT_RELEASE_DELAY_MS = 2000

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

interface RenderGroupedEntryOptions {
  expandedTextPartIds: ReadonlySet<string>
  onTextPartExpandedChange: (partId: string, expanded: boolean) => void
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

function canJoinPreviewGroup(entry: PartEntry, groupEntry: PartEntry): boolean {
  const part = entry.part
  const groupPart = groupEntry.part
  if (isImageFilePart(part) && isImageFilePart(groupPart)) return true
  if (isToolUIPart(part) && isToolUIPart(groupPart)) return true
  return (
    isDataUIPart(part) &&
    part.type === 'data-video' &&
    isDataUIPart(groupPart) &&
    groupPart.type === 'data-video' &&
    getVideoFilePath(part) === getVideoFilePath(groupPart)
  )
}

function isRenderablePreviewEntry(entry: PartEntry, messageId: string): boolean {
  const part = entry.part
  const partType = part.type as string

  if (isToolUIPart(part)) return buildToolRenderItems([entry], messageId).length > 0
  if (isImageFilePart(part)) return !!extractImageUrl(part)
  if (isDataUIPart(part) && part.type === 'data-video') return !!part.data
  if (partType === 'source-url' || partType === 'step-start' || partType === 'data-agent-task-event') return false
  if (partType === 'data-citation') return false

  return true
}

function getPreviewGroupedEntries(entries: readonly PartEntry[], limit: number, messageId: string): GroupedEntry[] {
  const reversedGroups: GroupedEntry[] = []
  let previewEntryCount = 0

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!isRenderablePreviewEntry(entry, messageId)) continue
    if (previewEntryCount >= limit) break

    const latestGroup = reversedGroups[reversedGroups.length - 1]
    if (Array.isArray(latestGroup) && canJoinPreviewGroup(entry, latestGroup[0])) {
      latestGroup.unshift(entry)
      previewEntryCount++
      continue
    }

    if (
      isImageFilePart(entry.part) ||
      isToolUIPart(entry.part) ||
      (isDataUIPart(entry.part) && entry.part.type === 'data-video')
    ) {
      reversedGroups.push([entry])
    } else {
      reversedGroups.push(entry)
    }
    previewEntryCount++
  }

  return reversedGroups.reverse()
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

function getToolPartName(part: CherryMessagePart): string {
  const toolPart = part as { toolName?: string; type?: string }
  if (toolPart.toolName?.trim()) return toolPart.toolName
  if (toolPart.type?.startsWith('tool-')) return toolPart.type.replace(/^tool-/, '')
  return ''
}

function isFoldableToolPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part)) return false
  return !isAskUserQuestionToolName(getToolPartName(part))
}

function isTrailingHoldPart(part: CherryMessagePart): boolean {
  return isResultPart(part) || isReasoningMessagePart(part)
}

function getLeadingSingleReasoningGroup(entries: readonly PartEntry[]): {
  collapsedEntries: PartEntry[]
  resultEntries: PartEntry[]
} | null {
  if (entries.length === 0 || !isReasoningMessagePart(entries[0].part)) return null

  let reasoningCount = 0
  for (const entry of entries) {
    if (isReasoningMessagePart(entry.part)) {
      reasoningCount++
      continue
    }
    if (!isResultPart(entry.part)) return null
  }
  if (reasoningCount !== 1) return null

  return {
    collapsedEntries: [entries[0]],
    resultEntries: entries.slice(1)
  }
}

function getTrailingResultHoldKey(entries: readonly PartEntry[]): string | null {
  let lastToolEntry: PartEntry | undefined
  let lastToolPosition = -1
  for (let position = entries.length - 1; position >= 0; position--) {
    if (isFoldableToolPart(entries[position].part)) {
      lastToolEntry = entries[position]
      lastToolPosition = position
      break
    }
  }
  if (!lastToolEntry || lastToolPosition >= entries.length - 1) return null

  for (let position = lastToolPosition + 1; position < entries.length; position++) {
    if (!isTrailingHoldPart(entries[position].part)) return null
  }

  const toolPart = lastToolEntry.part as { toolCallId?: string; toolName?: string; type?: string }
  const trailingSignature = entries
    .slice(lastToolPosition + 1)
    .map(({ index, part }) => `${index}:${part.type}`)
    .join('|')
  return `${lastToolEntry.index}:${toolPart.toolCallId ?? toolPart.toolName ?? toolPart.type ?? 'tool'}:${trailingSignature}`
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
    if ((entry.part.type as string) !== 'file' || isImageFilePart(entry.part)) continue

    const name = getFileEntryName(entry)
    if (name) fileEntryNameCounts.set(name, (fileEntryNameCounts.get(name) ?? 0) + 1)
  }

  const usedTokenIndexes = new Set<number>()
  return entries.filter((entry) => {
    if ((entry.part.type as string) !== 'file' || isImageFilePart(entry.part)) return true

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

/**
 * "Process" parts are the low-value steps of an agentic turn — tool calls,
 * reasoning, and hidden markers — that get tucked into a collapsed fold so the
 * model's actual prose reads as a clean conversation. Everything else (text,
 * code, errors, images, files, video) is "value" content shown directly.
 */
function isProcessPart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  return (
    isFoldableToolPart(part) ||
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

function hasProcessTail(entries: readonly PartEntry[]): boolean {
  const lastEntry = entries.at(-1)
  return lastEntry ? isProcessPart(lastEntry.part) : false
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

  switch (partType) {
    case 'reasoning': {
      const reasoningPart = part
      return (
        <ThinkingBlock
          key={partId}
          id={partId}
          content={reasoningPart.text || ''}
          isStreaming={reasoningPart.state === 'streaming'}
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
          userContentExpanded={message.role === 'user' ? options?.expandedTextPartIds.has(partId) : undefined}
          onUserContentExpandedChange={
            message.role === 'user' ? (expanded) => options?.onTextPartExpandedChange(partId, expanded) : undefined
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
  isTranslationOverlayActive: boolean,
  options?: RenderGroupedEntryOptions
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
  const rendered = renderPart(entry.part, partId, message, isStreaming, isTranslationOverlayActive, options)
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
  isActiveTurnProcessing: boolean,
  shouldHoldTrailingResult: boolean
): {
  collapsedEntries: PartEntry[]
  resultEntries: PartEntry[]
  toolCount: number
  hasResult: boolean
  hasLiveProcessTail: boolean
  summaryType: 'tools' | 'thinking'
} | null {
  if (message.role !== 'assistant') return null

  const singleReasoningGroup = getLeadingSingleReasoningGroup(entries)
  if (singleReasoningGroup) {
    const reasoningPart = singleReasoningGroup.collapsedEntries[0].part as ReasoningUIPart
    return {
      collapsedEntries: singleReasoningGroup.collapsedEntries,
      resultEntries: singleReasoningGroup.resultEntries,
      toolCount: 0,
      hasResult: singleReasoningGroup.resultEntries.some((entry) => isResultPart(entry.part)),
      hasLiveProcessTail: isActiveTurnProcessing && reasoningPart.state === 'streaming',
      summaryType: 'thinking'
    }
  }

  let lastToolIndex = -1
  for (let index = entries.length - 1; index >= 0; index--) {
    if (isFoldableToolPart(entries[index].part)) {
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

  if (shouldHoldTrailingResult) {
    collapsedEnd = entries.length - 1
  }

  const collapsedEntries = entries.slice(0, collapsedEnd + 1)
  const resultEntries = entries.slice(collapsedEnd + 1)
  const hasResult = resultEntries.some((entry) => isResultPart(entry.part))
  const hasLiveProcessTail = isActiveTurnProcessing && hasProcessTail(entries)
  const hasCollapsedTail = collapsedEnd > lastToolIndex
  if (message.status === 'success' && !isActiveTurnProcessing && !hasResult && !hasCollapsedTail) return null

  const toolCount = buildToolRenderItems(collapsedEntries, message.id).length
  if (toolCount === 0) return null

  return {
    collapsedEntries,
    resultEntries,
    toolCount,
    hasResult,
    hasLiveProcessTail,
    summaryType: 'tools'
  }
}

/** Whether trailing reasoning after the last tool is still streaming — drives
 * the "thinking" hint in the live fold header. */
function hasStreamingReasoningAfterLastTool(entries: readonly PartEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const { part } = entries[index]
    if (isFoldableToolPart(part)) return false
    if ((part.type as string) === 'reasoning' && (part as ReasoningUIPart).state === 'streaming') return true
  }
  return false
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

/**
 * The big outer fold for the whole agentic process. It stays collapsed by
 * default and shows a bounded process preview while collapsed; expanding
 * reveals the process in full. The final answer renders outside, below this fold.
 */
const OuterProcessFold = React.memo(function OuterProcessFold({
  entries,
  hasLiveProcessTail,
  message,
  toolCount,
  isProcessing,
  summary
}: {
  entries: readonly PartEntry[]
  hasLiveProcessTail: boolean
  message: MessageListItem
  toolCount: number
  isProcessing: boolean
  summary: React.ReactNode
}) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [previewDismissed, setPreviewDismissed] = React.useState(false)
  const contentId = React.useId()
  const previewRef = React.useRef<HTMLDivElement | null>(null)
  const wasPreviewVisibleRef = React.useRef(false)
  const shouldSmoothPreviewScrollRef = React.useRef(false)

  const showLiveProgress = isProcessing && hasLiveProcessTail
  const renderableEntries = useMemo(
    () => filterToolHistoryReasoningEntries(entries, showLiveProgress),
    [entries, showLiveProgress]
  )
  const shouldHoldPreview = isProcessing
  const wasHoldingPreviewRef = React.useRef(shouldHoldPreview)
  const showPreview = !isExpanded && !previewDismissed && shouldHoldPreview && renderableEntries.length > 0
  const showDynamicHeader = showLiveProgress && !isExpanded
  const toolItems = useMemo(
    () => (showPreview ? [] : buildToolRenderItems(entries, message.id)),
    [entries, message.id, showPreview]
  )
  const groupedEntries = useMemo(
    () => (isExpanded ? groupPartEntries(renderableEntries) : []),
    [isExpanded, renderableEntries]
  )
  const previewEntries = useMemo(
    () =>
      showPreview ? getPreviewGroupedEntries(renderableEntries, TOOL_HISTORY_PREVIEW_ENTRY_LIMIT, message.id) : [],
    [message.id, renderableEntries, showPreview]
  )
  const elapsedMs = usePlaceholderElapsedMs(showLiveProgress, message.createdAt, 1000)
  const completedElapsedMs = useMemo(() => {
    if (showLiveProgress || isProcessing) return undefined
    if (typeof message.stats?.timeCompletionMs === 'number') return message.stats.timeCompletionMs
    if (!message.updatedAt) return undefined
    const startedAt = Date.parse(message.createdAt)
    const finishedAt = Date.parse(message.updatedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return undefined
    return finishedAt - startedAt
  }, [isProcessing, message.createdAt, message.stats?.timeCompletionMs, message.updatedAt, showLiveProgress])
  const elapsedText = showLiveProgress
    ? formatPlaceholderElapsed(elapsedMs, t)
    : completedElapsedMs !== undefined
      ? formatPlaceholderElapsed(completedElapsedMs, t)
      : undefined
  const resolvedSummary =
    !isProcessing && toolCount > 0 && completedElapsedMs !== undefined ? t('message.tools.processed') : summary
  const activityLabel =
    showDynamicHeader && hasStreamingReasoningAfterLastTool(entries) ? t('message.tools.thinkingHeader') : undefined
  const showBottomCollapseButton = isExpanded && toolCount > BOTTOM_COLLAPSE_TOOL_COUNT_THRESHOLD

  React.useLayoutEffect(() => {
    if (!showPreview) {
      wasPreviewVisibleRef.current = false
      shouldSmoothPreviewScrollRef.current = false
      return
    }

    const preview = previewRef.current
    if (!preview || wasPreviewVisibleRef.current) return

    preview.scrollTop = preview.scrollHeight
    wasPreviewVisibleRef.current = true
    shouldSmoothPreviewScrollRef.current = false
  }, [showPreview])

  React.useEffect(() => {
    if (!showPreview) return

    const preview = previewRef.current
    if (!preview) return

    if (!shouldSmoothPreviewScrollRef.current) {
      shouldSmoothPreviewScrollRef.current = true
      return
    }

    if (typeof preview.scrollTo === 'function') {
      preview.scrollTo({ top: preview.scrollHeight, behavior: 'smooth' })
      return
    }

    preview.scrollTop = preview.scrollHeight
  }, [previewEntries, showPreview])

  React.useEffect(() => {
    if (wasHoldingPreviewRef.current && !shouldHoldPreview) {
      setIsExpanded(false)
    }
    if (!shouldHoldPreview) {
      setPreviewDismissed(false)
    }
    wasHoldingPreviewRef.current = shouldHoldPreview
  }, [shouldHoldPreview])

  const triggerClassName = [
    !showLiveProgress && '-ml-0.5',
    'flex min-h-7',
    'w-full',
    'items-center justify-start gap-1.5 rounded border-0 bg-transparent px-0 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="group/process-history w-full max-w-full">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className={triggerClassName}
        onClick={() => setIsExpanded((expanded) => !expanded)}>
        <ToolBlockGroupHeaderContent
          items={toolItems}
          activityLabel={activityLabel}
          elapsedText={elapsedText}
          summary={resolvedSummary}
          isLiveProgress={showDynamicHeader}
          preferSummary={isExpanded || showPreview}
          showLatestWhenComplete={showDynamicHeader && !showPreview}
        />
      </button>
      <div aria-hidden="true" data-testid="tool-history-divider" className="my-1.5 h-px w-full bg-border-subtle" />
      <AnimatePresence initial={false}>
        {showPreview && (
          <motion.div
            key="tool-history-preview"
            data-testid="tool-history-preview"
            className="group/preview relative h-[5rem] w-full overflow-hidden rounded-lg bg-background-subtle"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: '5rem', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}>
            <button
              type="button"
              aria-label={t('common.close')}
              className="absolute top-1.5 right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 group-focus-within/preview:opacity-100 group-hover/preview:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                setPreviewDismissed(true)
              }}>
              <X aria-hidden="true" size={13} strokeWidth={1.8} />
            </button>
            <div
              ref={previewRef}
              aria-hidden="true"
              inert
              className="pointer-events-none flex h-full w-full flex-col gap-0 overflow-y-auto px-2.5 py-0.5 pr-7 [scrollbar-width:thin] [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0! [&_.message-thought-container]:leading-5! [&_.tool-block-group-content]:gap-0! [&_[role='button']]:min-h-6! [&_[role='button']]:py-0! [&_button]:min-h-6! [&_button]:py-0!">
              {previewEntries.map((entry) => renderGroupedEntry(entry, message, false, false))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {isExpanded && (
        <div
          id={contentId}
          data-testid="tool-history-content"
          className="flex w-full flex-col gap-2 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!">
          {groupedEntries.map((entry) => renderGroupedEntry(entry, message, false, false))}
        </div>
      )}
      {showBottomCollapseButton && (
        <button
          type="button"
          aria-controls={contentId}
          className="mt-2 flex w-full items-center gap-2 rounded px-0 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          onClick={() => setIsExpanded(false)}>
          <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
          <span className="shrink-0">{t('message.tools.collapse')}</span>
          <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
        </button>
      )}
    </div>
  )
})

// ============================================================================
// Main component
// ============================================================================

const MessagePartsRenderer: React.FC<Props> = ({ message }) => {
  const { t } = useTranslation()
  const messageParts = useMessageParts(message.id)
  const { status: topicStreamStatus, isPending: isTopicStreaming } = useTopicStreamStatus(message.topicId)
  const topicTurnState = classifyTurn(topicStreamStatus)
  const isStreaming = isTopicStreaming && message.status === 'pending'
  const isTranslationOverlayActive = useTranslationOverlayEntry(message.id) !== undefined
  const renderConfig = useMessageRenderConfig()
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

  // Beat loader visible only when THIS specific message is the active turn
  // target. The identity predicate lives in `useIsActiveTurnTarget` so
  // consumers do not over-scope topic-level stream status to user messages.
  const isProcessing = useIsActiveTurnTarget(message)
  const isActiveTurnProcessing =
    isProcessing && (topicStreamStatus === undefined ? message.status !== 'success' : topicTurnState.isTurnActive)

  const partEntries = useMemo(
    () => messageParts.flatMap((part, index) => (hasPartParentToolCallId(part) ? [] : [{ part, index }])),
    [messageParts]
  )
  const trailingResultHoldKey = useMemo(
    () => (isActiveTurnProcessing ? getTrailingResultHoldKey(partEntries) : null),
    [isActiveTurnProcessing, partEntries]
  )
  const [releasedTrailingResultKey, setReleasedTrailingResultKey] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!trailingResultHoldKey) {
      setReleasedTrailingResultKey(null)
      return
    }
    if (releasedTrailingResultKey === trailingResultHoldKey) return

    const timer = window.setTimeout(() => {
      setReleasedTrailingResultKey(trailingResultHoldKey)
    }, TRAILING_RESULT_RELEASE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [releasedTrailingResultKey, trailingResultHoldKey])
  const shouldHoldTrailingResult = trailingResultHoldKey !== null && releasedTrailingResultKey !== trailingResultHoldKey
  const placeholderStatus = useMemo(() => getProcessingPlaceholderStatus(partEntries), [partEntries])
  const collapseEnabled = renderConfig.collapseCompletedToolHistory
  // The whole agentic process (tools + reasoning) collapses behind one outer
  // fold; the answer that follows renders below it. Present throughout the turn
  // (collapsed, live header while streaming) so it never flips in/out.
  const toolHistoryGroup = useMemo(
    () =>
      collapseEnabled
        ? getToolHistoryGroup(partEntries, message, isActiveTurnProcessing, shouldHoldTrailingResult)
        : null,
    [collapseEnabled, partEntries, message, isActiveTurnProcessing, shouldHoldTrailingResult]
  )
  const reportArtifactToolResponses = useMemo(
    () => getReportArtifactToolResponses(partEntries, message.id),
    [partEntries, message.id]
  )
  // Everything not folded into the history group renders flat: the answer after
  // the fold, or all parts when there's no fold (no tools / collapse disabled).
  const visibleEntries = toolHistoryGroup?.resultEntries ?? partEntries
  const visibleComposerFileTokens = useMemo(
    () => getVisibleComposerFileTokens(messageParts, message, expandedTextPartIds),
    [expandedTextPartIds, message, messageParts]
  )
  const displayEntries = useMemo(
    () => getDisplayEntries(visibleEntries, message, visibleComposerFileTokens),
    [message, visibleComposerFileTokens, visibleEntries]
  )
  const grouped = useMemo(() => (displayEntries.length === 0 ? [] : groupPartEntries(displayEntries)), [displayEntries])
  const renderOptions = useMemo(
    () => ({
      expandedTextPartIds,
      onTextPartExpandedChange: handleTextPartExpandedChange
    }),
    [expandedTextPartIds, handleTextPartExpandedChange]
  )
  const renderedEntries = useMemo(
    () =>
      grouped.map((entry) =>
        renderGroupedEntry(entry, message, isStreaming, isTranslationOverlayActive, renderOptions)
      ),
    [grouped, isStreaming, isTranslationOverlayActive, message, renderOptions]
  )
  const hasRenderedEntries = renderedEntries.some(Boolean)

  // No parts to render — normal for user messages (content is in message text, not parts)
  // But if the message is processing (pending/streaming), show the loading placeholder
  if (
    partEntries.length === 0 ||
    (isProcessing && !toolHistoryGroup && !hasRenderedEntries && reportArtifactToolResponses.length === 0)
  ) {
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
      {toolHistoryGroup && (
        <AnimatedBlockWrapper key={`tool-history-${message.id}`} enableAnimation={false}>
          <OuterProcessFold
            entries={toolHistoryGroup.collapsedEntries}
            hasLiveProcessTail={toolHistoryGroup.hasLiveProcessTail}
            message={message}
            toolCount={toolHistoryGroup.toolCount}
            isProcessing={isActiveTurnProcessing}
            summary={
              toolHistoryGroup.summaryType === 'thinking'
                ? t(toolHistoryGroup.hasLiveProcessTail ? 'message.tools.thinkingHeader' : 'common.reasoning_content')
                : t('message.tools.groupHeader', { count: toolHistoryGroup.toolCount })
            }
          />
        </AnimatedBlockWrapper>
      )}
      {renderedEntries}
      {reportArtifactToolResponses.length > 0 && (
        <AnimatedBlockWrapper key={`report-artifacts-${message.id}`} enableAnimation={isStreaming} animation="fade">
          <MessageReportArtifacts toolResponses={reportArtifactToolResponses} />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
}

export default React.memo(MessagePartsRenderer)
