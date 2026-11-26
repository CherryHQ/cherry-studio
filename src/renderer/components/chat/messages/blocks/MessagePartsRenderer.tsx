/**
 * MessagePartsRenderer — message parts renderer.
 *
 * Routes CherryMessagePart[] directly to leaf components. No intermediate
 * block conversion — each part type is rendered from its raw data.
 *
 * Process groups and directly visible content follow part order.
 *
 * Within a segment, grouping logic:
 * - Consecutive file parts with image mediaType → image block row
 * - Consecutive tool-* / dynamic-tool parts → nested ToolBlockGroup row
 * - data-video parts with same filePath → video block row
 */
import { getToolName, isDataUIPart, isFileUIPart, isToolUIPart } from 'ai'
import { maxBy } from 'es-toolkit'
import { Check, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { ChatTokenView } from '@renderer/components/composer/chatTokenView'
import type { ReadOnlyComposerFileTokenPreview } from '@renderer/components/composer/tokenView'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ProjectionLayoutContext } from '@renderer/hooks/agent/ProjectionReaderProvider'
import { ProjectionPartContext, useProjectionPart } from '@renderer/hooks/agent/useProjectionPart'
import { messageProjectionService } from '@renderer/services/aiTransport'
import {
  getCachedMessageUiState,
  subscribeCachedMessageUiState,
  updateCachedMessageUiState
} from '@renderer/services/messageUiStateCache'
import type { InputFilePreview } from '@renderer/types/inputFilePreview'
import type { Citation, ProjectionRowReader, ProjectionPartReader } from '@renderer/types/message'
import { fileHandleFromPart } from '@renderer/utils/file/fileHandle'
import {
  isCitationSourcePart,
  type MessageCitations,
  resolveCitationMarkerParts,
  type ResolvedCitationMarkers,
  resolveMessageCitations
} from '@renderer/utils/message/citations'
import { readComposerFileTokenIdSuffix } from '@renderer/utils/message/composerFileTokenSource'
import { getDisplayComposerTokens } from '@renderer/utils/message/composerTokens'
import { collect, single, filterProjectionRow, type Range } from '@renderer/utils/message/projectionRange'
import {
  type CitationReferenceView,
  convertReferencesToCitationReferences,
  convertReferencesToCitations
} from '@renderer/utils/partsToBlocks'
import type { CompactionAnchorData } from '@shared/ai/compaction'
import type { FileHandle } from '@shared/data/types/file'
import type { CherryMessagePart, ContentReference, ReasoningUIPart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ComposerMessageSnapshot, ComposerMessageToken } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema, type FileUrlString } from '@shared/types/file'
import { fileUrlToPath } from '@shared/utils/file'

import MessageAttachments from '../frame/MessageAttachments'
import { useMessageDisclosureState } from '../hooks/useMessageDisclosureState'
import ChatMarkdown, { type InlineHtmlPreviewMode } from '../markdown/ChatMarkdown'
import {
  useMessageListActions,
  useMessageListActiveTurnStatus,
  useMessageListItemActivityState,
  useMessagePriorCitationParts,
  useMessageRenderConfig
} from '../MessageListProvider'
import {
  isCherrySessionToolResponse,
  isReportArtifactsToolResponse,
  MessageReportArtifacts,
  SessionResultCards
} from '../tools/agent'
import { McpAppResultCards } from '../tools/mcp/McpAppResultCards'
import MessageTools, { canRenderMessageTool } from '../tools/MessageTools'
import { AgentToolsType, isAskUserQuestionToolName } from '../tools/shared/agentToolTypes'
import { hasPartParentToolCallId } from '../tools/toolParentMetadata'
import { buildToolResponseFromPart, type ToolRenderItem, type ToolResponseLike } from '../tools/toolResponse'
import type { MessageListItem } from '../types'
import { getMessageListPartId } from '../utils/messageListItem'
import {
  EMPTY_LAYOUT,
  projectAddressedLayout,
  layoutPart,
  type AddressedEntry,
  type HistoryRun,
  type HistorySection,
  type PartLayout,
  type ToolFold
} from './addressedPartLayout'
import AgentSessionForkBlock from './AgentSessionForkBlock'
import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import CompactionAnchorBlock from './CompactionAnchorBlock'
import ConversationResetBlock from './ConversationResetBlock'
import ErrorBlock from './ErrorBlock'
import { ImportedStatusBlock } from './ImportedStatusBlock'
import MainTextBlock, { buildUserMessagePreview } from './MainTextBlock'
import MessageCompactionStatus from './MessageCompactionStatus'
import MessageImageBlock, { type MessageImageSource } from './MessageImageBlock'
import {
  findOpenTextTailIndex,
  isHiddenPart,
  isInlineLayoutPart,
  isProcessToolPart,
  isReasoningMessagePart,
  isResultPart,
  isSubstantiveAnswerPart,
  type MessagePartLayoutItem,
  type PartEntry,
  projectCompletedMessageParts,
  projectLiveMessageParts
} from './messagePartLayouts'
import { ToolPartScopeProvider, useMessageParts, useMessagePartsScopeId } from './MessagePartsContext'
import MessageProcessGroup from './MessageProcessGroup'
import { type CellRange, PartRange, PartRuns, reconcileResultCells } from './PartRange'
import PlaceholderBlock, { type PlaceholderStatus } from './PlaceholderBlock'
import RetryStatusBlock from './RetryStatusBlock'
import { SubagentStatusContext } from './SubagentStatusContext'
import ThinkingBlock, { ThinkingBlockContent } from './ThinkingBlock'
import {
  getToolFoldTitle,
  hasToolIntent,
  ToolBlockGroup,
  ToolBlockGroupContent,
  ToolBlockGroupRow
} from './ToolBlockGroup'
import TranslationBlock from './TranslationBlock'

const logger = loggerService.withContext('MessagePartsRenderer')

// The same references array must convert to the same citation array identities
// across renders: a fresh array here cascades into ChatMarkdown's components
// map and forces Streamdown to re-render (and re-animate) every markdown block
// on each streaming tick.
const referenceCitationsCache = new WeakMap<
  ContentReference[],
  { citations: Citation[]; citationReferences?: CitationReferenceView[] }
>()

const MessageVideo = React.lazy(() => import('../frame/MessageVideo'))

// A completed process group mounts its whole tool history when it defaults to
// expanded. Ordinary turns stay collapsed (Agent sessions included): the outer
// completed group starts collapsed and an explicit user toggle still wins
// through the disclosure cache. Oversized histories always start collapsed as
// a render-budget guard, independent of the default.
const COMPLETED_HISTORY_AUTO_EXPAND_MAX_ENTRIES = 80
const COMPLETED_HISTORY_AUTO_EXPAND_MAX_TEXT_CHARS = 100 * 1024

/**
 * Bounded string-length estimate for a tool part payload. Walks objects without
 * materialising a JSON string so a multi-megabyte output cannot allocate here.
 */
function estimatePayloadLength(value: unknown, budget: number, depth = 0): number {
  if (budget <= 0 || value === null || value === undefined) return 0
  if (typeof value === 'string') return Math.min(value.length, budget)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length
  if (depth >= 8) return 0

  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) {
      total += 2 + estimatePayloadLength(item, budget - total, depth + 1)
      if (total >= budget) break
    }
    return total
  }

  if (typeof value === 'object') {
    let total = 0
    const record = value as Record<string, unknown>
    // Enumerated key by key: `Object.entries` reads every value up front, so a wide
    // payload would be fully traversed before the budget below could stop the walk.
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue
      total += key.length + 4
      total += estimatePayloadLength(record[key], budget - total, depth + 1)
      if (total >= budget) break
    }
    return total
  }

  return 0
}

function isCompletedHistoryOversized(entries: readonly PartEntry[]): boolean {
  if (entries.length > COMPLETED_HISTORY_AUTO_EXPAND_MAX_ENTRIES) return true

  let total = 0
  for (const entry of entries) {
    const part = entry.part as CherryMessagePart & { text?: unknown; input?: unknown; output?: unknown }
    total += estimatePayloadLength(part.text, COMPLETED_HISTORY_AUTO_EXPAND_MAX_TEXT_CHARS - total)
    if (isToolUIPart(entry.part)) {
      total += estimatePayloadLength(part.input, COMPLETED_HISTORY_AUTO_EXPAND_MAX_TEXT_CHARS - total)
      total += estimatePayloadLength(part.output, COMPLETED_HISTORY_AUTO_EXPAND_MAX_TEXT_CHARS - total)
    }
    if (total >= COMPLETED_HISTORY_AUTO_EXPAND_MAX_TEXT_CHARS) return true
  }

  return false
}

// ============================================================================
// Animation shared by message block renderers.
// ============================================================================

const blockWrapperStaticVariant = {
  opacity: 1,
  transition: { duration: 0 }
}

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
    ...blockWrapperStaticVariant,
    x: 0
  }
}

const blockWrapperFadeVariants: Variants = {
  visible: {
    opacity: 1,
    transition: { duration: 0.2 }
  },
  hidden: {
    opacity: 0
  },
  static: blockWrapperStaticVariant
}

const AnimatedBlockWrapper: React.FC<{
  children: React.ReactNode
  enableAnimation: boolean
  className?: string
  animation?: 'slide' | 'fade'
  messagePartId?: string
}> = ({ className, children, enableAnimation, animation = 'slide', messagePartId }) => {
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
      <div className={wrapperClassName} data-message-part-id={messagePartId}>
        <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
      </div>
    )
  }
  const variants = animation === 'fade' ? blockWrapperFadeVariants : blockWrapperVariants
  return (
    <motion.div
      className={wrapperClassName}
      data-message-part-id={messagePartId}
      variants={variants}
      initial={enableAnimation ? 'hidden' : false}
      animate={enableAnimation ? 'visible' : 'static'}>
      <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
    </motion.div>
  )
}

// ============================================================================
// Props
// ============================================================================

interface Props {
  message: MessageListItem
  /** File attachments are rendered outside this subtree (see `getHoistedAttachments`). */
  hoistAttachments?: boolean
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

function toImageSource(part: CherryMessagePart): MessageImageSource | undefined {
  const url = extractImageUrl(part)
  return url ? { handle: fileHandleFromPart(part), url } : undefined
}

export interface HoistedFileAttachment {
  key: string
  handle: FileHandle
  inputFilePreview?: InputFilePreview
  name: string
  ext: string
}

function toFileAttachment(part: CherryMessagePart, key: string): HoistedFileAttachment | undefined {
  const handle = fileHandleFromPart(part)
  if (!handle) return undefined

  const name = (part as { filename?: string }).filename ?? ''
  const preview = readOnlyFileTokenPreviewFromPart(part)
  const previewPath = getPreviewPathFromFileUrl(preview?.url)
  const inputFilePreview =
    preview && previewPath
      ? {
          displayName: name,
          previewPath,
          fileEntryId: preview.fileEntryId,
          originalPath: preview.originalPath,
          mediaType: preview.mediaType,
          composerFileKind: preview.composerFileKind
        }
      : undefined
  return { key, handle, name, ext: name.match(/\.[^.]+$/)?.[0] ?? '', inputFilePreview }
}

// Must agree with what the hoisting container actually renders, or a dropped entry
// leaves no attachment at all.
function isHoistableFilePart(part: CherryMessagePart, hoistNonImageFiles: boolean): boolean {
  if ((part.type as string) !== 'file') return false
  if (isImageFilePart(part)) return !!extractImageUrl(part)
  return hoistNonImageFiles && !!fileHandleFromPart(part)
}

/** Attachments a hoisting container renders in place of the inline file blocks. */
export function getHoistedAttachments(
  parts: readonly CherryMessagePart[],
  messageId: string,
  hoistNonImageFiles = false
) {
  const images: MessageImageSource[] = []
  const files: HoistedFileAttachment[] = []

  parts.forEach((part, index) => {
    if (!isHoistableFilePart(part, hoistNonImageFiles)) return
    if (isImageFilePart(part)) {
      const source = toImageSource(part)
      if (source) images.push(source)
      return
    }
    const attachment = toFileAttachment(part, `${messageId}-part-${index}`)
    if (attachment) files.push(attachment)
  })

  return { images, files }
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
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  enableAnimation?: boolean
  expandToolGroups?: boolean
  expandLiveToolGroups?: boolean
  thoughtAutoCollapse?: boolean
  expandedTextPartIds?: ReadonlySet<string>
  messageCitations?: MessageCitations
  citationProjectionByPart?: ReadonlyMap<CherryMessagePart, ResolvedCitationMarkers>
  readOnlyFilePreviews?: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
  onReadOnlyFilePreviewActivate?: (
    preview: ReadOnlyComposerFileTokenPreview,
    token: ChatTokenView
  ) => void | Promise<void>
  hiddenComposerTokens?: ReadonlySet<ComposerMessageToken>
  onTextPlayoutSettledChange?: (partId: string, settled: boolean) => void
  onTextPartExpandedChange?: (partId: string, expanded: boolean) => void
  reasoningDisplay?: 'content' | 'disclosure'
  settleActiveTools?: boolean
  settleStreamingReasoning?: boolean
  toolDisplay?: 'content' | 'disclosure'
}

const EMPTY_CITATION_PROJECTIONS: ReadonlyMap<CherryMessagePart, ResolvedCitationMarkers> = new Map()
const EMPTY_HIDDEN_COMPOSER_TOKENS: ReadonlySet<ComposerMessageToken> = new Set()
const EMPTY_EXPANDED_TEXT_PART_IDS: ReadonlySet<string> = new Set()

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
  token: ComposerMessageToken
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
  expandedTextPartIds: ReadonlySet<string>,
  composer: ComposerMessageSnapshot
): string {
  const text = (part as { text?: string }).text ?? ''
  if (message.role !== 'user' || expandedTextPartIds.has(partId)) return text

  return buildUserMessagePreview(text, composer).content
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
    const partId = getMessageListPartId(message, index)
    const text = getComposerTokenDisplayText(part, message, partId, expandedTextPartIds, composer)

    return getDisplayComposerTokens(composer).flatMap((token) => {
      if (token.kind !== 'file' || !isComposerTokenVisibleInText(token, text)) return []
      return [{ token, sourceId: readComposerFileTokenIdSuffix(token.id), names: getComposerFileTokenNames(token) }]
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

const EMPTY_ASSOCIATED_READ_ONLY_FILE_PREVIEWS: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview> = new Map()

function readOnlyFileTokenPreviewFromPart(part: CherryMessagePart): ReadOnlyComposerFileTokenPreview | undefined {
  if (!isFileUIPart(part)) return undefined

  const cherryMeta = getCherryMeta(part)
  const originalPath = cherryMeta?.originalPath
    ? AbsoluteFilePathSchema.safeParse(cherryMeta.originalPath).data
    : undefined

  return {
    url: part.url,
    ...(cherryMeta?.fileEntryId && { fileEntryId: cherryMeta.fileEntryId }),
    mediaType: part.mediaType,
    ...(originalPath && { originalPath }),
    ...(cherryMeta?.composerFileKind && { composerFileKind: cherryMeta.composerFileKind })
  }
}

function getReadOnlyFileTokenPreviews(
  parts: readonly CherryMessagePart[]
): ReadonlyMap<string, ReadOnlyComposerFileTokenPreview> {
  const previews = new Map<string, ReadOnlyComposerFileTokenPreview>()

  for (const part of parts) {
    const sourceId = getCherryMeta(part)?.fileTokenSourceId
    if (!sourceId) continue
    const preview = readOnlyFileTokenPreviewFromPart(part)
    if (preview) previews.set(sourceId, preview)
  }

  return previews
}

function getPreviewPathFromFileUrl(url: string | undefined) {
  if (!url) return null
  try {
    const parsed = fileUrlToPath(url as FileUrlString)
    return AbsoluteFilePathSchema.safeParse(parsed).data ?? null
  } catch {
    return null
  }
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

// A blank text part still counts as content while it carries a visible token chip. Once every
// one of its tokens is hoisted away, rendering it leaves an empty line inside the bubble.
function rendersOnlyHoistedTokens(entry: PartEntry, hiddenTokens: ReadonlySet<ComposerMessageToken>): boolean {
  const { part } = entry
  if (part.type !== 'text' || part.text?.trim()) return false

  const composer = getCherryMeta(part)?.composer
  if (!composer) return false
  const tokens = getDisplayComposerTokens(composer)
  return tokens.length > 0 && tokens.every((token) => hiddenTokens.has(token))
}

function getDisplayProjection(
  entries: readonly PartEntry[],
  message: MessageListItem,
  visibleComposerFileTokens: readonly VisibleComposerFileToken[],
  hoistAttachments: boolean,
  hoistNonImageFiles: boolean
): {
  entries: PartEntry[]
  hiddenImageTokens: ReadonlySet<ComposerMessageToken>
  associatedReadOnlyFilePreviews: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
} {
  const isHoistedEntry = (entry: PartEntry) => hoistAttachments && isHoistableFilePart(entry.part, hoistNonImageFiles)

  if (message.role !== 'user' || visibleComposerFileTokens.length === 0) {
    return {
      entries: entries.filter((entry) => !isHoistedEntry(entry)),
      hiddenImageTokens: EMPTY_HIDDEN_COMPOSER_TOKENS,
      associatedReadOnlyFilePreviews: EMPTY_ASSOCIATED_READ_ONLY_FILE_PREVIEWS
    }
  }

  const fileEntryNameCounts = new Map<string, number>()
  for (const entry of entries) {
    if ((entry.part.type as string) !== 'file') continue

    const name = getFileEntryName(entry)
    if (name) fileEntryNameCounts.set(name, (fileEntryNameCounts.get(name) ?? 0) + 1)
  }

  // Explicit source ids claim their tokens before any filename fallback, independent of part order.
  const explicitTokenIndexes = new Set<number>()
  for (const entry of entries) {
    if ((entry.part.type as string) !== 'file') continue
    const sourceId = getFileEntrySourceId(entry)
    if (!sourceId) continue
    const matchIndex = findUniqueVisibleFileTokenIndex(
      visibleComposerFileTokens,
      explicitTokenIndexes,
      (token) => token.sourceId === sourceId
    )
    if (matchIndex !== undefined) explicitTokenIndexes.add(matchIndex)
  }

  const usedTokenIndexes = new Set<number>()
  const displayEntries: PartEntry[] = []
  const hiddenImageTokens = new Set<ComposerMessageToken>()
  const associatedReadOnlyFilePreviews = new Map<string, ReadOnlyComposerFileTokenPreview>()
  for (const entry of entries) {
    if ((entry.part.type as string) !== 'file') {
      displayEntries.push(entry)
      continue
    }

    const sourceId = getFileEntrySourceId(entry)
    let matchIndex = sourceId
      ? findUniqueVisibleFileTokenIndex(
          visibleComposerFileTokens,
          usedTokenIndexes,
          (token) => token.sourceId === sourceId
        )
      : undefined

    if (matchIndex === undefined) {
      const name = getFileEntryName(entry)
      const filenameExcluded = new Set<number>([...usedTokenIndexes, ...explicitTokenIndexes])
      matchIndex =
        name && fileEntryNameCounts.get(name) === 1
          ? findUniqueVisibleFileTokenIndex(visibleComposerFileTokens, filenameExcluded, (token) =>
              token.names.has(name)
            )
          : undefined
    }

    if (matchIndex === undefined) {
      if (!isHoistedEntry(entry)) displayEntries.push(entry)
      continue
    }

    const matchedToken = visibleComposerFileTokens[matchIndex]
    const hoisted = isHoistedEntry(entry)
    const mappedPreview =
      !hoisted && matchedToken.sourceId && !isImageFilePart(entry.part)
        ? readOnlyFileTokenPreviewFromPart(entry.part)
        : undefined
    const imageKeepsOwnControl = hoisted || (isImageFilePart(entry.part) && !!extractImageUrl(entry.part))
    // A filename hit with no token key must not drop the only remaining control.
    if (!mappedPreview && !imageKeepsOwnControl) {
      if (!isHoistedEntry(entry)) displayEntries.push(entry)
      continue
    }

    usedTokenIndexes.add(matchIndex)
    if (mappedPreview && matchedToken.sourceId) {
      associatedReadOnlyFilePreviews.set(matchedToken.sourceId, mappedPreview)
    }
    if (isHoistedEntry(entry)) {
      hiddenImageTokens.add(matchedToken.token)
    } else if (isImageFilePart(entry.part) && extractImageUrl(entry.part)) {
      displayEntries.push(entry)
      hiddenImageTokens.add(matchedToken.token)
    }
  }

  return {
    entries: displayEntries.filter((entry) => !rendersOnlyHoistedTokens(entry, hiddenImageTokens)),
    hiddenImageTokens,
    associatedReadOnlyFilePreviews:
      associatedReadOnlyFilePreviews.size === 0
        ? EMPTY_ASSOCIATED_READ_ONLY_FILE_PREVIEWS
        : associatedReadOnlyFilePreviews
  }
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
  return visiblePart(part, entry.partId ?? `${messageId}-part-${entry.index}`)
}

function visiblePart(part: CherryMessagePart, id: string): boolean {
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
    const toolResponse = getCachedToolProjection(part, id).toolResponse
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
    return part.providerMetadata.cherry
  }
  return undefined
}

// Keep normalized error identity stable across parent renders.
const ErrorPartView = React.memo(function ErrorPartView({
  partId,
  part,
  message
}: {
  partId: string
  part: Extract<CherryMessagePart, { type: 'data-error' }>
  message: MessageListItem
}) {
  const rawData = part.data
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

const TranslationPartView = React.memo(function TranslationPartView({
  content,
  id,
  isStreaming,
  messageId
}: {
  content: string
  id: string
  isStreaming: boolean
  messageId: string
}) {
  const { removeMessageTranslation, notifySuccess } = useMessageListActions()
  const { t } = useTranslation()
  const handleRemoveTranslation = React.useCallback(async () => {
    await removeMessageTranslation?.(messageId)
    notifySuccess?.(t('translate.closed'))
  }, [messageId, notifySuccess, removeMessageTranslation, t])

  return (
    <TranslationBlock
      id={id}
      content={content}
      isStreaming={isStreaming}
      onDelete={removeMessageTranslation ? handleRemoveTranslation : undefined}
    />
  )
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
  options?: RenderGroupedEntryOptions
): React.ReactNode {
  const partType = part.type
  const inlineHtmlPreviewMode =
    message.role === 'assistant'
      ? (options?.inlineHtmlPreviewMode ?? (message.status === 'success' ? 'ready' : undefined))
      : undefined

  switch (partType) {
    case 'data-imported-status':
      return <ImportedStatusBlock key={partId} status={part.data.status} />
    case 'reasoning': {
      const reasoningPart = part
      const isReasoningStreaming = !options?.settleStreamingReasoning && reasoningPart.state === 'streaming'
      if (options?.reasoningDisplay === 'content') {
        return (
          <ThinkingBlockContent
            key={partId}
            id={partId}
            content={reasoningPart.text || ''}
            livePart={isReasoningStreaming ? reasoningPart : undefined}
            isStreaming={isReasoningStreaming}
          />
        )
      }
      return (
        <ThinkingBlock
          key={partId}
          id={partId}
          content={reasoningPart.text || ''}
          livePart={isReasoningStreaming ? reasoningPart : undefined}
          isStreaming={isReasoningStreaming}
          showTitlePreview
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
      return <CompactionAnchorBlock key={partId} data={(part as { data?: CompactionAnchorData }).data} />

    case 'data-conversation-reset':
      return <ConversationResetBlock key={partId} />

    case 'data-agent-session-fork':
      return <AgentSessionForkBlock key={partId} sourceSessionId={part.data.sourceSessionId} />

    case 'data-translation': {
      const translationData = (part as { data: { content: string } }).data
      return (
        <TranslationPartView
          key={partId}
          id={partId}
          content={translationData.content}
          isStreaming={isStreaming}
          messageId={message.id}
        />
      )
    }

    case 'text': {
      const cherryMeta = getCherryMeta(part)
      const references = cherryMeta?.references as ContentReference[] | undefined
      let converted = references ? referenceCitationsCache.get(references) : undefined
      if (references && !converted) {
        converted = {
          citations: convertReferencesToCitations(references),
          citationReferences: convertReferencesToCitationReferences(references, partId)
        }
        referenceCitationsCache.set(references, converted)
      }
      return (
        <MainTextBlock
          key={partId}
          id={partId}
          content={part.text || ''}
          livePart={isStreaming && message.role === 'assistant' ? part : undefined}
          isStreaming={isStreaming}
          citations={converted?.citations}
          citationReferences={converted?.citationReferences}
          inlineHtmlPreviewMode={inlineHtmlPreviewMode}
          messageCitations={message.role === 'assistant' ? options?.messageCitations : undefined}
          toolCitationProjection={options?.citationProjectionByPart?.get(part)}
          role={message.role}
          composer={cherryMeta?.composer}
          readOnlyFilePreviews={options?.readOnlyFilePreviews}
          onReadOnlyFilePreviewActivate={options?.onReadOnlyFilePreviewActivate}
          hiddenComposerTokens={options?.hiddenComposerTokens}
          userContentExpanded={message.role === 'user' ? options?.expandedTextPartIds?.has(partId) : undefined}
          onPlayoutSettledChange={options?.onTextPlayoutSettledChange}
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
        <MainTextBlock
          key={partId}
          id={partId}
          content={codeContent}
          inlineHtmlPreviewMode={inlineHtmlPreviewMode}
          isStreaming={isStreaming}
          role={message.role}
          onPlayoutSettledChange={options?.onTextPlayoutSettledChange}
        />
      )
    }

    case 'data-error': {
      const errorPart = part
      if (!errorPart.data) return null
      return <ErrorPartView key={partId} partId={partId} part={errorPart} message={message} />
    }

    case 'data-video': {
      const rawData = 'data' in part ? part.data : undefined
      if (!rawData) return null
      return (
        <React.Suspense key={partId} fallback={null}>
          <MessageVideo url={rawData.url} filePath={rawData.filePath} />
        </React.Suspense>
      )
    }

    case 'data-retry': {
      const rawData = 'data' in part ? part.data : undefined
      if (!rawData) return null
      return <RetryStatusBlock key={partId} data={rawData} />
    }

    case 'data-agent-task-event':
      // Agent task events are hidden inline state consumed by the agent status panes.
      return null

    case 'data-knowledge-scope':
      // User-turn capability scope is consumed by Main and never rendered inline.
      return null

    case 'data-clear':
      // Context boundaries render at the message-frame level as a divider.
      return null

    case 'file': {
      const filePart = part as { url?: string; mediaType?: string; filename?: string }
      if (filePart.mediaType?.startsWith('image/')) {
        const source = toImageSource(part)
        if (!source) return null
        return <MessageImageBlock key={partId} sources={[source]} isSingle={true} thumbnail={message.role === 'user'} />
      }
      const attachment = toFileAttachment(part, partId)
      if (!attachment) {
        logger.warn('File part addresses no file, skipping', { filename: filePart.filename })
        return null
      }
      return (
        <MessageAttachments
          key={partId}
          handle={attachment.handle}
          inputFilePreview={attachment.inputFilePreview}
          name={attachment.name}
          ext={attachment.ext}
          createdAt={message.createdAt}
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
    projection.renderItem = { id: partId, part, toolResponse }
  }
  projectionsById.set(partId, projection)
  return projection
}

function settleToolResponse(toolResponse: ToolResponseLike): ToolResponseLike {
  if (!['pending', 'invoking', 'streaming'].includes(toolResponse.status)) return toolResponse
  return { ...toolResponse, status: 'cancelled' }
}

const ToolPartView = React.memo(function ToolPartView({
  part: fallback,
  partId,
  settleActiveTools
}: {
  part: CherryMessagePart
  partId: string
  settleActiveTools?: boolean
}) {
  const messageId = useMessagePartsScopeId()
  const part = useProjectionPart(partId, fallback) ?? fallback
  const toolResponse = getCachedToolProjection(part, partId).toolResponse
  if (!toolResponse) return null
  return (
    <ToolPartScopeProvider messageId={messageId} part={part}>
      <MessageTools toolResponse={settleActiveTools ? settleToolResponse(toolResponse) : toolResponse} />
    </ToolPartScopeProvider>
  )
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
    const id = e.partId ?? `${messageId}-part-${e.index}`
    const renderItem = getCachedToolProjection(e.part, id).renderItem
    return renderItem ? [settleActiveTools ? settleToolRenderItem(renderItem) : renderItem] : []
  })
}

function getReportArtifactToolResponses(entries: readonly PartEntry[], messageId: string) {
  return entries.flatMap((entry) => {
    const toolResponse = getCachedToolProjection(
      entry.part,
      entry.partId ?? `${messageId}-part-${entry.index}`
    ).toolResponse
    return toolResponse && isReportArtifactsToolResponse(toolResponse) ? [toolResponse] : []
  })
}

function isReportArtifactEntry(entry: PartEntry, messageId: string): boolean {
  const toolResponse = getCachedToolProjection(
    entry.part,
    entry.partId ?? `${messageId}-part-${entry.index}`
  ).toolResponse
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
  options?: RenderGroupedEntryOptions
): React.ReactNode {
  const enableAnimation = options?.enableAnimation ?? isStreaming

  if (Array.isArray(entry)) {
    const groupKey = entry.map((e) => e.partId ?? `${message.id}-part-${e.index}`).join('-')
    const firstPart = entry[0].part

    if (isImageFilePart(firstPart)) {
      const images = entry.map((e) => toImageSource(e.part)).filter((s) => s !== undefined)
      if (images.length === 0) return null

      const thumbnail = message.role === 'user'
      if (images.length === 1) {
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={enableAnimation}>
            <MessageImageBlock sources={images} isSingle={true} thumbnail={thumbnail} />
          </AnimatedBlockWrapper>
        )
      }
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={enableAnimation}>
          <MessageImageBlock sources={images} isSingle={false} thumbnail={thumbnail} />
        </AnimatedBlockWrapper>
      )
    }

    if (isToolUIPart(firstPart)) {
      const toolItems = buildToolRenderItems(entry, message.id, options?.settleActiveTools)
      if (toolItems.length === 0) return null

      const stableGroupKey = `tool-group-${message.id}-part-${entry[0].partId ?? entry[0].index}`
      return (
        <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={enableAnimation} animation="fade">
          {options?.toolDisplay === 'disclosure' ? (
            <ToolBlockGroup items={toolItems} defaultExpanded={options?.expandToolGroups} />
          ) : (
            <ToolBlockGroupContent items={toolItems} />
          )}
        </AnimatedBlockWrapper>
      )
    }

    if (isDataUIPart(firstPart) && firstPart.type === 'data-video') {
      const firstEntry = entry[0]
      const partId = firstEntry.partId ?? `${message.id}-part-${firstEntry.index}`
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={enableAnimation}>
          {renderPart(firstEntry.part, partId, message, isStreaming)}
        </AnimatedBlockWrapper>
      )
    }

    return null
  }

  const partId = entry.partId ?? `${message.id}-part-${entry.index}`
  return renderSingleEntry(entry.part, partId, message, isStreaming, { ...options, enableAnimation })
}

function renderSingleEntry(
  part: CherryMessagePart,
  partId: string,
  message: MessageListItem,
  isStreaming: boolean,
  options: RenderGroupedEntryOptions
): React.ReactNode {
  const rendered = renderPart(part, partId, message, isStreaming, options)
  if (!rendered) return null

  const wrapperClassName =
    part.type === 'text' ? 'text-foreground' : isReasoningMessagePart(part) ? 'message-thought-wrapper' : undefined

  return (
    <AnimatedBlockWrapper
      key={partId}
      enableAnimation={options.enableAnimation ?? isStreaming}
      className={wrapperClassName}
      messagePartId={part.type === 'text' ? partId : undefined}>
      {rendered}
    </AnimatedBlockWrapper>
  )
}

function findLastProcessItemIndex(items: readonly MessagePartLayoutItem[]): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index].kind === 'process') return index
  }
  return -1
}

type NestedHistoryItem =
  | { kind: 'process'; key: string | number; entries: PartEntry[] }
  | { kind: 'content'; key: string | number; entry: GroupedEntry }

function groupNestedHistoryEntries(entries: readonly PartEntry[]): NestedHistoryItem[] {
  const result: NestedHistoryItem[] = []
  let contentEntries: PartEntry[] = []
  let processEntries: PartEntry[] = []

  const flushContent = () => {
    for (const entry of groupPartEntries(contentEntries)) {
      const firstEntry = Array.isArray(entry) ? entry[0] : entry
      result.push({ kind: 'content', key: firstEntry.partId ?? firstEntry.index, entry })
    }
    contentEntries = []
  }

  const flushProcess = () => {
    if (processEntries.length > 0) {
      result.push({
        kind: 'process',
        key: processEntries[0].partId ?? processEntries[0].index,
        entries: processEntries
      })
    }
    processEntries = []
  }

  for (const entry of entries) {
    if (isHiddenPart(entry.part)) continue

    if (isToolUIPart(entry.part) && isAskUserQuestionToolName(getToolName(entry.part))) {
      flushProcess()
      flushContent()
      result.push({ kind: 'content', key: entry.partId ?? entry.index, entry })
      continue
    }

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

function hasVisibleReasoningInCompletedHistory(entries: readonly PartEntry[], messageId: string): boolean {
  // Follow the history disclosure so tool-intent-hidden reasoning does not change the outer fold state.
  if (!entries.some((entry) => isReasoningMessagePart(entry.part))) return false

  for (const item of groupNestedHistoryEntries(entries)) {
    if (item.kind !== 'process') continue
    if (!item.entries.some((entry) => isReasoningMessagePart(entry.part))) continue
    const toolItems = buildToolRenderItems(item.entries, messageId, true)
    if (toolItems.length === 0) return true
    if (!toolItems.some(hasToolIntent)) return true
  }

  return false
}

function renderNestedHistory(
  entries: readonly PartEntry[],
  message: MessageListItem,
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
      return renderGroupedEntry(item.entry, message, false, options)
    }

    if (options.toolDisplay !== 'disclosure') {
      return (
        <React.Fragment key={`process-${message.id}-${item.key}`}>
          {groupPartEntries(item.entries).map((entry) => renderGroupedEntry(entry, message, false, options))}
        </React.Fragment>
      )
    }

    const toolItems = buildToolRenderItems(item.entries, message.id, options.settleActiveTools)
    if (toolItems.length === 0) {
      return (
        <React.Fragment key={`reasoning-${message.id}-${item.key}`}>
          {groupPartEntries(item.entries).map((entry) =>
            renderGroupedEntry(entry, message, false, {
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
    const thinkingPart = isCurrentProcess && lastProcessEntry?.part.type === 'reasoning' ? lastProcessEntry : undefined

    // Stated intents already say what each step is for, so thinking blocks between them only add noise.
    const showsReasoning = !toolItems.some(hasToolIntent)
    const visibleEntries = groupPartEntries(item.entries).filter(
      (entry) => showsReasoning || Array.isArray(entry) || !isReasoningMessagePart(entry.part)
    )
    // Live and completed histories have separate defaults: Agent keeps running
    // steps visible while the turn runs, while ordinary chat keeps them folded
    // behind the group header until clicked. The completed `expandToolSteps`
    // default only gates finished histories. Both live and completed histories
    // also stay open when the thought preference asks for visible reasoning,
    // so a mixed reasoning + tool turn does not hide the thought behind a
    // closed child group.
    const isLiveNested = liveProcessMode !== undefined
    const containsReasoning = item.entries.some((entry) => isReasoningMessagePart(entry.part))
    const keepReasoningVisible = options.thoughtAutoCollapse === false && containsReasoning && showsReasoning
    const nestedDefaultExpanded = isLiveNested
      ? (options.expandLiveToolGroups ?? false) || keepReasoningVisible
      : (options.expandToolGroups ?? false) || keepReasoningVisible

    return (
      <AnimatedBlockWrapper key={`nested-process-${message.id}-${item.key}`} enableAnimation={false} animation="fade">
        <ToolBlockGroup
          items={toolItems}
          defaultExpanded={nestedDefaultExpanded}
          isLiveProgress={isLiveProgress}
          thinkingPart={thinkingPart}>
          <div className="flex w-full flex-col gap-1 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!">
            {visibleEntries.map((entry) =>
              renderGroupedEntry(entry, message, false, {
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
    previous.every(
      (entry, index) =>
        entry.index === next[index].index && entry.partId === next[index].partId && entry.part === next[index].part
    )
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
    message,
    renderOptions
  }: {
    enableAnimation: boolean
    entry: GroupedEntry
    isStreaming: boolean
    message: MessageListItem
    renderOptions: RenderGroupedEntryOptions
  }) {
    return renderGroupedEntry(entry, message, isStreaming, {
      ...renderOptions,
      enableAnimation
    })
  },
  (previous, next) =>
    previous.enableAnimation === next.enableAnimation &&
    previous.isStreaming === next.isStreaming &&
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
    hasTrailingContent,
    isLatest,
    isStreamLive,
    message,
    renderOptions
  }: {
    entries: readonly PartEntry[]
    hasTrailingContent: boolean
    isLatest: boolean
    isStreamLive: boolean
    message: MessageListItem
    renderOptions: RenderGroupedEntryOptions
  }) {
    const toolItems = useMemo(() => buildToolRenderItems(entries, message.id), [entries, message.id])
    const renderHistory = React.useCallback(
      (isExpanded: boolean) =>
        isExpanded
          ? renderNestedHistory(
              entries,
              message,
              {
                ...renderOptions,
                enableAnimation: false,
                settleStreamingReasoning: !isStreamLive,
                toolDisplay: 'disclosure'
              },
              isStreamLive && !hasTrailingContent ? 'last' : 'settled'
            )
          : null,
      [entries, hasTrailingContent, isStreamLive, message, renderOptions]
    )

    return (
      <MessageProcessGroup phase="active" message={message} showElapsed={isLatest} toolItems={toolItems}>
        {renderHistory}
      </MessageProcessGroup>
    )
  },
  (previous, next) =>
    previous.hasTrailingContent === next.hasTrailingContent &&
    previous.isLatest === next.isLatest &&
    previous.isStreamLive === next.isStreamLive &&
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
  hasTrailingContent,
  isActive,
  liveLayout,
  isStreamLive,
  keepIntermediateAssistantText,
  message,
  projectedLiveItems,
  renderOptions
}: {
  collapseHistory: boolean
  entries: readonly PartEntry[]
  hasTrailingContent: boolean
  isActive: boolean
  liveLayout?: PartLayout
  isStreamLive: boolean
  keepIntermediateAssistantText: boolean
  message: MessageListItem
  projectedLiveItems: readonly MessagePartLayoutItem[]
  renderOptions: RenderGroupedEntryOptions
}) {
  const completedLayout = useMemo(
    () => (isActive ? null : projectCompletedMessageParts(entries, { keepIntermediateAssistantText })),
    [entries, isActive, keepIntermediateAssistantText]
  )
  const items = completedLayout?.items ?? projectedLiveItems
  const boundary = useMemo(() => findLastProcessItemIndex(items), [items])
  const tail = useMemo(
    () => items.slice(boundary + 1).flatMap((item) => (item.kind === 'part' ? [item.entry] : [])),
    [boundary, items]
  )
  const results = useMemo(() => groupPartEntries(tail), [tail])
  const completedRenderOptions = useMemo(
    () => ({ ...renderOptions, settleActiveTools: true, settleStreamingReasoning: true }),
    [renderOptions]
  )
  const activeResultRenderOptions = useMemo<RenderGroupedEntryOptions>(
    () => ({ ...renderOptions, inlineHtmlPreviewMode: 'generating' }),
    [renderOptions]
  )
  const resultOptions = isActive ? activeResultRenderOptions : completedRenderOptions
  const openTextTailIndex = isActive && isStreamLive && !liveLayout ? findOpenTextTailIndex(entries) : null

  return (
    <>
      {liveLayout ? (
        <AddressedProcessHistory
          layout={liveLayout}
          isStreamLive={isStreamLive}
          message={message}
          options={renderOptions}
        />
      ) : (
        items.slice(0, boundary + 1).map((item, position) => {
          if (item.kind === 'part') {
            return (
              <MessageContentEntryView
                key={item.key}
                entry={item.entry}
                enableAnimation={false}
                isStreaming={false}
                message={message}
                renderOptions={resultOptions}
              />
            )
          }
          if (isActive) {
            return (
              <ActiveMessageProcess
                key={item.key}
                entries={item.entries}
                hasTrailingContent={position < boundary || hasTrailingContent}
                isLatest={position === boundary}
                isStreamLive={isStreamLive}
                message={message}
                renderOptions={renderOptions}
              />
            )
          }
          return (
            <CompletedProcessHistory
              key={item.key}
              groupId={item.key}
              entries={item.entries}
              collapseHistory={collapseHistory}
              tail={position === boundary ? tail : undefined}
              message={message}
              options={completedRenderOptions}
            />
          )
        })
      )}
      <MessageResultParts
        key="results"
        addressed={liveLayout?.tail}
        entries={results}
        openTextTailIndex={openTextTailIndex}
        openPartId={liveLayout?.openTail}
        enableAnimation={isActive && isStreamLive}
        message={message}
        options={resultOptions}
      />
    </>
  )
})

function CompletedProcessHistory({
  groupId,
  entries,
  collapseHistory,
  tail,
  message,
  options
}: {
  groupId: string | number
  entries: readonly PartEntry[]
  collapseHistory: boolean
  tail?: readonly PartEntry[]
  message: MessageListItem
  options: RenderGroupedEntryOptions
}) {
  const { expandToolSteps, thoughtAutoCollapse } = useMessageRenderConfig()
  const reasoningSyncTarget = hasVisibleReasoningInCompletedHistory(entries, message.id)
    ? !thoughtAutoCollapse
    : undefined
  const renderHistory = (isExpanded: boolean) =>
    isExpanded
      ? renderNestedHistory(entries, message, {
          ...options,
          reasoningDisplay: 'disclosure',
          toolDisplay: collapseHistory ? 'disclosure' : 'content'
        })
      : null

  if (!entries.some((entry) => isPotentiallyVisibleEntry(entry, message.id))) return null
  if (!collapseHistory) return renderHistory(true)

  const toolItems = buildToolRenderItems(entries, message.id, true)
  const shouldCheckOutcome = (entry: PartEntry) =>
    !isReasoningMessagePart(entry.part) && isPotentiallyVisibleEntry(entry, message.id)
  const lastOutcome = tail?.findLast(shouldCheckOutcome) ?? entries.findLast(shouldCheckOutcome)
  const lastPart = lastOutcome?.part
  const lastTool =
    lastOutcome && lastPart && isToolUIPart(lastPart)
      ? getCachedToolProjection(lastPart, lastOutcome.partId ?? `${message.id}-part-${lastOutcome.index}`).toolResponse
      : undefined
  const hasError =
    lastPart?.type === 'data-error' || lastTool?.status === 'error' || lastTool?.response?.isError === true

  return (
    <MessageProcessGroup
      groupId={groupId}
      phase="completed"
      outcome={hasError ? 'error' : 'success'}
      showElapsed={tail !== undefined}
      defaultExpanded={reasoningSyncTarget === true || (!isCompletedHistoryOversized(entries) && expandToolSteps)}
      syncExpanded={reasoningSyncTarget}
      message={message}
      toolItems={toolItems}>
      {renderHistory}
    </MessageProcessGroup>
  )
}

// ============================================================================
// Main component
// ============================================================================

interface MessagePartsRendererContentProps extends Props {
  collapseCompletedToolHistory: boolean
  isActiveTurnProcessing: boolean
  isStreamLive: boolean
  keepIntermediateAssistantText: boolean
  messageParts: CherryMessagePart[]
  priorCitationParts: readonly CherryMessagePart[]
  auxiliary?: readonly AddressedEntry[]
  liveLayout?: PartLayout
}

const ActiveTurnStatusView = ({ fallback }: { fallback: React.ReactNode }) => {
  const activeTurnStatus = useMessageListActiveTurnStatus()
  return activeTurnStatus ? activeTurnStatus(fallback) : fallback
}

function PendingPartContent({
  ids,
  placeholder,
  children
}: {
  ids: readonly string[]
  placeholder: React.ReactNode
  children: React.ReactNode
}) {
  const reader = React.use(ProjectionPartContext)
  const visible = React.useSyncExternalStore(
    useCallback(
      (listener) => {
        const subscriptions = ids.map((id) => reader?.subscribe(id, listener))
        return () => {
          for (const unsubscribe of subscriptions) unsubscribe?.()
        }
      },
      [ids, reader]
    ),
    useCallback(
      () =>
        ids.some((id) => {
          const part = reader?.read(id)
          return (part?.type === 'text' || part?.type === 'reasoning') && !!part.text.trim()
        }),
      [ids, reader]
    )
  )
  return !ids.length || visible ? children : placeholder
}

const MessagePartsRendererContent = React.memo(function MessagePartsRendererContent({
  collapseCompletedToolHistory,
  hoistAttachments,
  isActiveTurnProcessing,
  isStreamLive,
  keepIntermediateAssistantText,
  message,
  messageParts,
  priorCitationParts,
  auxiliary,
  liveLayout
}: MessagePartsRendererContentProps) {
  const { expandLiveToolSteps, expandToolSteps, subagentListTitle, thoughtAutoCollapse, userMessageDefaultExpanded } =
    useMessageRenderConfig()
  const { openAgentToolFlow, isAgentToolFlowActive, openFile, previewFile, previewInputFile } = useMessageListActions()
  const hoistNonImageFiles = !!hoistAttachments && !!(previewInputFile || previewFile || openFile)
  const { t } = useTranslation()
  const subscribeDisclosures = React.useCallback(
    (listener: () => void) => subscribeCachedMessageUiState(message.id, listener),
    [message.id]
  )
  const getDisclosures = React.useCallback(() => getCachedMessageUiState(message.id).disclosures, [message.id])
  const disclosures = React.useSyncExternalStore(subscribeDisclosures, getDisclosures, getDisclosures)
  const expandedTextPartIds = useMemo(() => {
    if (message.role !== 'user') return EMPTY_EXPANDED_TEXT_PART_IDS
    return new Set(
      messageParts.flatMap((part, index) => {
        const partId = getMessageListPartId(message, index)
        return part.type === 'text' && (disclosures?.[partId] ?? userMessageDefaultExpanded) ? [partId] : []
      })
    )
  }, [disclosures, message, messageParts, userMessageDefaultExpanded])
  const [unsettledTextPlayoutPartIds, setUnsettledTextPlayoutPartIds] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const handleTextPartExpandedChange = React.useCallback(
    (partId: string, expanded: boolean) => {
      updateCachedMessageUiState(message.id, (current) => {
        if (current.disclosures?.[partId] === expanded) return current
        return { ...current, disclosures: { ...current.disclosures, [partId]: expanded } }
      })
    },
    [message.id]
  )
  const handleTextPlayoutSettledChange = React.useCallback((partId: string, settled: boolean) => {
    setUnsettledTextPlayoutPartIds((current) => {
      const isUnsettled = current.has(partId)
      if (isUnsettled === !settled) return current

      const next = new Set(current)
      if (settled) {
        next.delete(partId)
      } else {
        next.add(partId)
      }
      return next
    })
  }, [])

  const partEntries = useMemo(() => {
    const shownErrors = new Set<string>()
    return messageParts.flatMap((part, index) => {
      if (hasPartParentToolCallId(part)) return []
      if (part.type === 'data-error') {
        // Older builds could persist one failure twice; each distinct error gets one card.
        const errorKey = JSON.stringify(part.data)
        if (shownErrors.has(errorKey)) return []
        shownErrors.add(errorKey)
      }
      return [
        {
          part,
          index,
          partId: auxiliary?.[index]?.key ?? messageProjectionService.getPartId(part) ?? message.partIds?.[index]
        }
      ]
    })
  }, [auxiliary, messageParts, message.partIds])
  const placeholderStatus = useMemo(
    () => liveLayout?.status ?? getProcessingPlaceholderStatus(partEntries),
    [liveLayout?.status, partEntries]
  )
  const nextReportArtifactToolResponses = useMemo(
    () => getReportArtifactToolResponses(partEntries, message.id),
    [partEntries, message.id]
  )
  const reportArtifactToolResponses = useStableItemArray(nextReportArtifactToolResponses)
  const sessionToolResponses = useMemo(
    () =>
      isActiveTurnProcessing
        ? []
        : buildToolRenderItems(partEntries, message.id, true)
            .map((item) => item.toolResponse)
            .filter(isCherrySessionToolResponse),
    [isActiveTurnProcessing, message.id, partEntries]
  )
  const explicitReadOnlyFilePreviews = useMemo(() => getReadOnlyFileTokenPreviews(messageParts), [messageParts])
  const handleReadOnlyFilePreviewActivate = useCallback(
    (preview: ReadOnlyComposerFileTokenPreview, token: ChatTokenView) => {
      if (!previewInputFile) return
      const previewPath = getPreviewPathFromFileUrl(preview.url)
      if (!previewPath) return

      return previewInputFile({
        displayName: token.label,
        previewPath,
        ...(preview.fileEntryId && { fileEntryId: preview.fileEntryId }),
        ...(preview.originalPath && { originalPath: preview.originalPath }),
        ...(preview.mediaType && { mediaType: preview.mediaType }),
        ...(preview.composerFileKind && { composerFileKind: preview.composerFileKind })
      })
    },
    [previewInputFile]
  )
  const visibleComposerFileTokens = useMemo(
    () => getVisibleComposerFileTokens(messageParts, message, expandedTextPartIds),
    [expandedTextPartIds, message, messageParts]
  )
  const displayProjection = useMemo(
    () => getDisplayProjection(partEntries, message, visibleComposerFileTokens, !!hoistAttachments, hoistNonImageFiles),
    [hoistAttachments, hoistNonImageFiles, message, partEntries, visibleComposerFileTokens]
  )
  const nextReadOnlyFilePreviews = useMemo(() => {
    const associated = displayProjection.associatedReadOnlyFilePreviews
    if (associated.size === 0) return explicitReadOnlyFilePreviews

    const merged = new Map(explicitReadOnlyFilePreviews)
    for (const [sourceId, preview] of associated) merged.set(sourceId, preview)
    return merged
  }, [displayProjection.associatedReadOnlyFilePreviews, explicitReadOnlyFilePreviews])
  const readOnlyFilePreviews = useStableReadOnlyFilePreviews(nextReadOnlyFilePreviews)
  const subagentEntries = useMemo(
    () =>
      openAgentToolFlow
        ? displayProjection.entries.filter((entry) => {
            if (!isToolUIPart(entry.part)) return false
            const name = getCachedToolProjection(entry.part, entry.partId ?? `${message.id}-part-${entry.index}`)
              .toolResponse?.tool.name
            return name === AgentToolsType.Agent || name === AgentToolsType.Task
          })
        : [],
    [displayProjection.entries, message.id, openAgentToolFlow]
  )
  const taskStatus = subagentEntries.length ? React.use(SubagentStatusContext) : undefined
  const subagentStatuses = subagentEntries.map(({ part, partId, index }) => {
    const response = getCachedToolProjection(part, partId ?? `${message.id}-part-${index}`).toolResponse
    return response ? (taskStatus?.(response.toolCallId, response.status) ?? response.status) : undefined
  })
  const completedSubagents = subagentStatuses.filter((status) => status === 'done').length
  const failedSubagents = subagentStatuses.filter((status) => status === 'error').length
  const stoppedSubagents = subagentStatuses.filter((status) => status === 'cancelled').length
  const allSubagentsCompleted = subagentEntries.length > 0 && completedSubagents === subagentEntries.length
  const viewingSubagent = subagentEntries.some(({ part, partId, index }) => {
    const response = getCachedToolProjection(part, partId ?? `${message.id}-part-${index}`).toolResponse
    return response?.toolCallId && isAgentToolFlowActive?.(response.toolCallId)
  })
  const [showSubagents, setSubagentsExpanded] = useMessageDisclosureState(
    'subtasks',
    isActiveTurnProcessing || !allSubagentsCompleted || viewingSubagent,
    message.id
  )
  React.useEffect(() => {
    if (viewingSubagent) setSubagentsExpanded(true)
  }, [viewingSubagent, setSubagentsExpanded])
  const subagentContentId = React.useId()
  const displayEntries = useMemo(() => {
    if (!subagentEntries.length) return displayProjection.entries
    const subtasks = new Set(subagentEntries)
    return displayProjection.entries.filter((entry) => !subtasks.has(entry))
  }, [displayProjection.entries, subagentEntries])
  const hasVisibleNonArtifactEntry = useMemo(
    () =>
      displayEntries.some(
        (entry) => isPotentiallyVisibleEntry(entry, message.id) && !isReportArtifactEntry(entry, message.id)
      ),
    [displayEntries, message.id]
  )
  const projectedLiveItems = useMemo(
    () =>
      isActiveTurnProcessing && !liveLayout
        ? projectLiveMessageParts(displayEntries, { keepIntermediateAssistantText }).filter(
            (item) => item.kind !== 'part' || !isReportArtifactEntry(item.entry, message.id)
          )
        : [],
    [displayEntries, isActiveTurnProcessing, keepIntermediateAssistantText, liveLayout, message.id]
  )
  // A process group can contain parts newer than the intermediate prose rendered after it.
  const liveTail = useMemo(
    () =>
      maxBy(projectedLiveItems, (item) =>
        item.kind === 'part' ? item.entry.index : (item.entries.at(-1)?.index ?? -1)
      ),
    [projectedLiveItems]
  )
  const showTrailingPlaceholder =
    isStreamLive &&
    (liveLayout ? liveLayout.trailingAnswer : liveTail?.kind === 'part' && isSubstantiveAnswerPart(liveTail.entry.part))
  // Settled tool parts keep their identity across streaming chunks, so citations only re-resolve
  // when a source part changes, not on every text delta.
  const nextCitationSourceParts = useMemo(() => messageParts.filter(isCitationSourcePart), [messageParts])
  const citationSourceParts = useStableItemArray(nextCitationSourceParts)
  const messageCitations = useMemo(
    () => resolveMessageCitations(citationSourceParts, message.role === 'assistant' ? priorCitationParts : undefined),
    [citationSourceParts, message.role, priorCitationParts]
  )
  const citationProjectionByPart = useMemo(() => {
    if (message.role !== 'assistant' || messageCitations.all.length === 0) return EMPTY_CITATION_PROJECTIONS
    const textParts = messageParts.filter((part) => {
      if (part.type !== 'text') return false
      const references = getCherryMeta(part)?.references as ContentReference[] | undefined
      return !references?.length || convertReferencesToCitations(references).length === 0
    })
    const projections = resolveCitationMarkerParts(
      textParts.map((part) => (part.type === 'text' ? part.text || '' : '')),
      messageCitations
    )
    return new Map(textParts.map((part, index) => [part, projections[index]]))
  }, [message.role, messageCitations, messageParts])
  const renderOptions = useMemo(
    () => ({
      citationProjectionByPart,
      expandToolGroups: expandToolSteps,
      expandLiveToolGroups: expandLiveToolSteps,
      thoughtAutoCollapse,
      expandedTextPartIds,
      messageCitations,
      readOnlyFilePreviews,
      onReadOnlyFilePreviewActivate: previewInputFile ? handleReadOnlyFilePreviewActivate : undefined,
      hiddenComposerTokens: displayProjection.hiddenImageTokens,
      onTextPlayoutSettledChange: handleTextPlayoutSettledChange,
      onTextPartExpandedChange: handleTextPartExpandedChange
    }),
    [
      expandLiveToolSteps,
      expandToolSteps,
      thoughtAutoCollapse,
      expandedTextPartIds,
      citationProjectionByPart,
      handleTextPartExpandedChange,
      handleTextPlayoutSettledChange,
      messageCitations,
      readOnlyFilePreviews,
      handleReadOnlyFilePreviewActivate,
      previewInputFile,
      displayProjection.hiddenImageTokens
    ]
  )
  const canRenderReportArtifacts =
    !isActiveTurnProcessing && unsettledTextPlayoutPartIds.size === 0 && reportArtifactToolResponses.length > 0
  const placeholder = isActiveTurnProcessing ? (
    <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
      <PlaceholderBlock isProcessing={true} createdAt={message.createdAt} status={placeholderStatus} />
    </AnimatedBlockWrapper>
  ) : null

  const empty =
    !liveLayout?.visible && !hasVisibleNonArtifactEntry && !canRenderReportArtifacts && !subagentEntries.length
  const pendingIds = useMemo(
    () =>
      !empty || !isActiveTurnProcessing
        ? []
        : liveLayout
          ? collect(liveLayout.pending)
          : displayEntries.flatMap(({ part, partId }) =>
              partId && (part.type === 'text' || part.type === 'reasoning') && part.state === 'streaming'
                ? [partId]
                : []
            ),
    [displayEntries, empty, isActiveTurnProcessing, liveLayout]
  )
  const emptyPlaceholder = empty && isActiveTurnProcessing && (
    <AnimatePresence mode="sync">
      <MessageCompactionStatus messageId={message.id} fallback={<ActiveTurnStatusView fallback={placeholder} />} />
    </AnimatePresence>
  )
  if (empty && !pendingIds.length) {
    if (isActiveTurnProcessing) return emptyPlaceholder
    return (
      <MessageCompactionStatus
        messageId={message.id}
        fallback={
          message.role === 'assistant' && message.status === 'paused' ? (
            <ChatMarkdown block={{ id: `${message.id}-paused`, content: '', status: 'paused' }} />
          ) : null
        }
      />
    )
  }

  const content = (
    <AnimatePresence mode="sync">
      <MessageProcessLayout
        key={`process-layout-${message.id}`}
        collapseHistory={collapseCompletedToolHistory}
        entries={displayEntries}
        hasTrailingContent={liveTail?.kind === 'part'}
        isActive={isActiveTurnProcessing}
        liveLayout={liveLayout}
        isStreamLive={isStreamLive}
        keepIntermediateAssistantText={keepIntermediateAssistantText}
        message={message}
        projectedLiveItems={projectedLiveItems}
        renderOptions={renderOptions}
      />
      {unsettledTextPlayoutPartIds.size === 0 && sessionToolResponses.length > 0 && (
        <AnimatedBlockWrapper key={`session-results-${message.id}`} enableAnimation={false} animation="fade">
          <SessionResultCards toolResponses={sessionToolResponses} />
        </AnimatedBlockWrapper>
      )}
      {message.role === 'assistant' && message.status !== 'pending' && (
        <McpAppResultCards key={`mcp-apps-${message.id}`} messageId={message.id} parts={messageParts} />
      )}
      {canRenderReportArtifacts && (
        <AnimatedBlockWrapper key={`report-artifacts-${message.id}`} enableAnimation={false} animation="fade">
          <MessageReportArtifacts toolResponses={reportArtifactToolResponses} />
        </AnimatedBlockWrapper>
      )}
      {subagentEntries.length > 0 && (
        <AnimatedBlockWrapper
          key={`subagents-${message.id}`}
          enableAnimation={false}
          animation="fade"
          className="mt-1!">
          <div className="-mx-2 mb-3">
            <Button
              variant="ghost"
              aria-expanded={showSubagents}
              aria-controls={subagentContentId}
              onClick={() => setSubagentsExpanded(!showSubagents)}
              className="h-8 max-w-full justify-start gap-2 px-2 text-xs font-normal text-muted-foreground">
              <ChevronDown
                className={showSubagents ? 'size-3.5 shrink-0' : 'size-3.5 shrink-0 -rotate-90'}
                aria-hidden="true"
              />
              <span className="flex min-w-0 items-center gap-2">
                <span>{subagentListTitle ?? t('agent.right_pane.flow.subtasks')}</span>
                <span>
                  {allSubagentsCompleted ? (
                    <>· {t('agent.right_pane.status.tasks_completed', { count: completedSubagents })}</>
                  ) : (
                    t('agent.right_pane.status.task_count', {
                      completed: completedSubagents,
                      total: subagentEntries.length
                    })
                  )}
                  {failedSubagents > 0 && (
                    <>
                      {' '}
                      · {failedSubagents} {t('message.tools.status.failed')}
                    </>
                  )}
                  {stoppedSubagents > 0 && (
                    <>
                      {' '}
                      · {stoppedSubagents} {t('message.tools.cancelled')}
                    </>
                  )}
                </span>
              </span>
              {allSubagentsCompleted && (
                <span className="shrink-0 text-success">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
              )}
            </Button>
            {showSubagents && (
              <div id={subagentContentId} className="mt-1 flex flex-col gap-1">
                {subagentEntries.map(({ part, partId, index }) =>
                  renderToolPart(part, partId ?? `${message.id}-part-${index}`, !isActiveTurnProcessing)
                )}
              </div>
            )}
          </div>
        </AnimatedBlockWrapper>
      )}
      <MessageCompactionStatus
        messageId={message.id}
        fallback={
          isActiveTurnProcessing ? (
            <ActiveTurnStatusView fallback={showTrailingPlaceholder ? placeholder : null} />
          ) : null
        }
      />
    </AnimatePresence>
  )
  return (
    <PendingPartContent ids={pendingIds} placeholder={emptyPlaceholder}>
      {content}
    </PendingPartContent>
  )
})

const NO_TOOLS: ToolRenderItem[] = []
const renderToolRow = (item: ToolRenderItem) => <ToolBlockGroupRow key={item.id} item={item} />
const renderFold = (fold: ToolFold) =>
  fold.first === fold.last ? (
    renderToolRow(fold.first)
  ) : (
    <ToolBlockGroup header={{ candidates: [fold.first, fold.last], count: fold.items.size }} title={fold.title}>
      <div className="flex w-full flex-col gap-2">
        <PartRange range={fold.items} render={renderToolRow} />
      </div>
    </ToolBlockGroup>
  )

const AddressedHistoryRun = React.memo(function AddressedHistoryRun({
  run,
  last,
  message,
  options
}: {
  run: HistoryRun
  last: boolean
  message: MessageListItem
  options: RenderGroupedEntryOptions
}) {
  const renderEntry = useCallback(
    ({ key, part }: AddressedEntry) => {
      if (isToolUIPart(part) && run.kind === 'process') {
        const item = getCachedToolProjection(part, key).renderItem
        return item ? renderToolRow(item) : null
      }
      return renderSingleEntry(part, key, message, false, options)
    },
    [message, options, run.kind]
  )
  if (run.kind === 'barrier') return null
  if (run.kind === 'images') {
    const sources = collect(run.entries)
      .map(({ part }) => toImageSource(part))
      .filter((source) => source !== undefined)
    return (
      sources.length > 0 && (
        <AnimatedBlockWrapper enableAnimation={false}>
          <MessageImageBlock sources={sources} isSingle={sources.length === 1} thumbnail={false} />
        </AnimatedBlockWrapper>
      )
    )
  }
  if (run.kind === 'video' || run.kind === 'content') return renderEntry(run.end)
  if (!run.firstTool || !run.lastTool) return <PartRange range={run.entries} render={renderEntry} />
  const items = [
    ...new Set([run.firstTool, run.running, run.waiting, run.lastTool].filter((item) => item !== undefined))
  ]
  const thinking = last && run.end.part.type === 'reasoning' ? { partId: run.end.key, part: run.end.part } : undefined
  return (
    <AnimatedBlockWrapper enableAnimation={false} animation="fade">
      <ToolBlockGroup
        header={{ candidates: items, count: run.toolCount! }}
        defaultExpanded={options.expandToolGroups}
        isLiveProgress={last}
        thinkingPart={thinking}>
        <div className="flex w-full flex-col gap-1 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!">
          {run.hasIntent && run.folds ? (
            <PartRuns runs={run.folds} render={renderFold} />
          ) : (
            <PartRange range={run.entries} render={renderEntry} />
          )}
        </div>
      </ToolBlockGroup>
    </AnimatedBlockWrapper>
  )
})

function AddressedProcessHistory({
  layout,
  message,
  isStreamLive,
  options
}: {
  layout: PartLayout
  message: MessageListItem
  isStreamLive: boolean
  options: RenderGroupedEntryOptions
}) {
  const historyOptions = useMemo(
    () => ({ ...options, enableAnimation: false, settleStreamingReasoning: !isStreamLive }),
    [options, isStreamLive]
  )
  const renderHistory = useCallback(
    (run: HistoryRun, last: boolean) => (
      <AddressedHistoryRun run={run} last={last} message={message} options={historyOptions} />
    ),
    [message, historyOptions]
  )
  const hasTail = !!layout.tail
  const renderSection = useCallback(
    (section: HistorySection, last: boolean) =>
      section.kind === 'inline' ? (
        <MessageContentEntryView
          entry={{ part: section.entry.part, partId: section.entry.key, index: 0 }}
          enableAnimation={false}
          isStreaming={false}
          message={message}
          renderOptions={options}
        />
      ) : (
        <MessageProcessGroup phase="active" message={message} showElapsed={last} toolItems={NO_TOOLS}>
          {() => <PartRuns runs={section.runs} render={renderHistory} last={last && isStreamLive && !hasTail} />}
        </MessageProcessGroup>
      ),
    [hasTail, isStreamLive, message, options, renderHistory]
  )
  return layout.history && <PartRuns runs={layout.history} render={renderSection} last />
}

function MessageResultParts({
  addressed,
  entries,
  openTextTailIndex,
  openPartId,
  enableAnimation,
  message,
  options
}: {
  addressed?: Range<AddressedEntry>
  entries: readonly GroupedEntry[]
  openTextTailIndex: number | null
  openPartId?: string
  enableAnimation: boolean
  message: MessageListItem
  options: RenderGroupedEntryOptions
}) {
  type Result = AddressedEntry | GroupedEntry
  const previous = React.useRef<CellRange<Result>>(undefined)
  const range = useMemo(
    () =>
      addressed ??
      reconcileResultCells(previous.current, entries, (entry) => {
        const first = Array.isArray(entry) ? entry[0] : entry
        return first.partId ?? `${message.id}-part-${first.index}`
      }),
    [addressed, entries, message.id]
  )
  React.useLayoutEffect(() => {
    previous.current = range
  }, [range])
  const render = useCallback(
    (entry: Result, last: boolean) => {
      const addressed = 'key' in entry
      const grouped = addressed ? { part: entry.part, partId: entry.key, index: 0 } : entry
      const streaming = addressed
        ? last && (entry.part.type === 'data-code' || (entry.part.type === 'text' && entry.part.state === 'streaming'))
        : !Array.isArray(entry) && entry.index === openTextTailIndex
      return (
        <MessageContentEntryView
          entry={grouped}
          enableAnimation={enableAnimation}
          isStreaming={enableAnimation && streaming}
          message={message}
          renderOptions={options}
        />
      )
    },
    [enableAnimation, message, openTextTailIndex, options]
  )
  return <PartRange range={range} render={render} last={enableAnimation && openPartId !== undefined} />
}

const noSubscription = () => () => {}
const noLayout = () => undefined

function useAddressedMessageParts(
  row: ProjectionRowReader | undefined,
  reader: ProjectionPartReader | undefined,
  keepIntermediateAssistantText: boolean,
  hoistAttachments?: boolean
) {
  const { openAgentToolFlow, openFile, previewInputFile, previewFile } = useMessageListActions()
  const { t } = useTranslation()
  const hoistFiles = !!(openFile || previewInputFile || previewFile)
  const hasTaskList = !!openAgentToolFlow
  const project = useMemo(
    () =>
      projectAddressedLayout((partId) => {
        const part = reader?.read(partId)
        if (!part || hasPartParentToolCallId(part)) return { layout: EMPTY_LAYOUT }
        const entry: AddressedEntry = { key: partId, part }
        const source = isCitationSourcePart(part)
        if (isHiddenPart(part))
          return {
            layout: source || part.type === 'data-agent-task-event' ? { side: single(partId, entry) } : EMPTY_LAYOUT
          }
        const cached = isToolUIPart(part) ? getCachedToolProjection(part, partId) : undefined
        const tool = cached?.renderItem
        const response = cached?.toolResponse
        const name = response?.tool.name
        if (hasTaskList && (name === AgentToolsType.Agent || name === AgentToolsType.Task))
          return { layout: { side: single(partId, entry), visible: true } }
        if (hoistAttachments && isHoistableFilePart(part, hoistFiles))
          return { layout: { side: single(partId, entry) } }
        const text = part.type === 'text' || part.type === 'reasoning'
        const blank = text && !part.text.trim() && !isSubstantiveAnswerPart(part)
        if (blank && part.state !== 'streaming') return { layout: { lastBody: partId } }
        const report = !!response && isReportArtifactsToolResponse(response)
        const kind: HistoryRun['kind'] = report
          ? 'barrier'
          : part.type === 'reasoning' || isProcessToolPart(part)
            ? 'process'
            : isImageFilePart(part)
              ? 'images'
              : part.type === 'data-video'
                ? 'video'
                : 'content'
        const result = layoutPart(
          entry,
          kind,
          !report && (isInlineLayoutPart(part) || (keepIntermediateAssistantText && part.type === 'text')),
          tool,
          tool && hasToolIntent(tool) ? getToolFoldTitle(tool, t) : undefined
        )
        if (source || report || (part.type === 'text' && (part.text.includes('[') || part.text.includes('【'))))
          result.side = single(partId, entry)
        result.status = cached
          ? 'usingTools'
          : part.type === 'reasoning'
            ? 'thinking'
            : isResultPart(part) || text
              ? 'generating'
              : undefined
        if (!report && !blank) result.trailingAnswer = kind !== 'process' && isSubstantiveAnswerPart(part)
        if (blank) result.pending = single(partId, partId)
        else result.visible = !report && visiblePart(part, partId)
        const ellipsis = part.type === 'text' && /^(?:\.{3}|…)$/.test(part.text.trim())
        if (ellipsis || blank)
          return {
            layout: result,
            beforeProcess: ellipsis && part.state !== 'streaming' ? { lastBody: partId } : undefined
          }
        const meaningful = part.type === 'reasoning' || isToolUIPart(part) ? 'process' : 'content'
        return { layout: result, first: meaningful, last: meaningful }
      }),
    [hasTaskList, hoistAttachments, hoistFiles, keepIntermediateAssistantText, reader, t]
  )
  const tree = React.useSyncExternalStore(row?.subscribe ?? noSubscription, row?.getSnapshot ?? noLayout)
  const layout = tree && project(tree)
  const auxiliary = useMemo(() => collect(layout?.side), [layout?.side])
  const sideParts = useMemo(() => auxiliary.map((entry) => entry.part), [auxiliary])
  return { layout, auxiliary, sideParts }
}

const MessagePartsRenderer: React.FC<Props> = ({ message, hoistAttachments }) => {
  const messageParts = useMessageParts(message.id)
  const { isActiveTurnProcessing, isStreamLive } = useMessageListItemActivityState(message)
  const priorCitationParts = useMessagePriorCitationParts(message.id)
  const { collapseCompletedToolHistory, keepIntermediateAssistantText } = useMessageRenderConfig()

  const reader = React.use(ProjectionPartContext)
  const layouts = React.use(ProjectionLayoutContext)
  const sourceRow =
    isActiveTurnProcessing && message.role === 'assistant'
      ? layouts?.row(message.sourceMessageId ?? message.id)
      : undefined
  const row = useMemo(
    () =>
      sourceRow && message.sourceMessageId && message.partIds
        ? filterProjectionRow(sourceRow, message.partIds)
        : sourceRow,
    [sourceRow, message.sourceMessageId, message.partIds]
  )
  const { layout, auxiliary, sideParts } = useAddressedMessageParts(
    row,
    reader,
    keepIntermediateAssistantText,
    hoistAttachments
  )
  const currentParts = useMemo(
    () =>
      !isActiveTurnProcessing && messageProjectionService.ownsRowParts(messageParts)
        ? messageProjectionService.readParts(messageParts)
        : messageParts,
    [isActiveTurnProcessing, messageParts]
  )
  return (
    <ProjectionPartContext value={isActiveTurnProcessing ? reader : undefined}>
      <MessagePartsRendererContent
        collapseCompletedToolHistory={collapseCompletedToolHistory}
        keepIntermediateAssistantText={keepIntermediateAssistantText}
        hoistAttachments={hoistAttachments}
        isActiveTurnProcessing={isActiveTurnProcessing}
        isStreamLive={isStreamLive}
        message={message}
        messageParts={layout ? sideParts : currentParts}
        liveLayout={layout}
        auxiliary={layout && auxiliary}
        priorCitationParts={priorCitationParts}
      />
    </ProjectionPartContext>
  )
}

export default React.memo(MessagePartsRenderer)
