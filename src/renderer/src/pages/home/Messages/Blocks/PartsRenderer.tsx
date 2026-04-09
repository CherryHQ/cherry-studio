/**
 * PartsRenderer — V2 replacement for MessageBlockRenderer.
 *
 * Routes CherryMessagePart[] directly to leaf components, bypassing
 * the legacy MessageBlock type system entirely.
 *
 * Grouping logic mirrors MessageBlockRenderer:
 * - Consecutive file parts with image mediaType → ImageGroup
 * - Consecutive tool-* / dynamic-tool parts → ToolBlockGroup
 * - data-video parts with same filePath → VideoGroup
 */

import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type {
  CitationMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  MessageBlock,
  ToolMessageBlock,
  VideoMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { isMessageProcessing } from '@renderer/utils/messageUtils/is'
import { mapMessageStatusToBlockStatus, partToBlock } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { CherryProviderMetadata } from '@shared/data/types/uiParts'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { use, useMemo } from 'react'

import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import TranslationBlock from './TranslationBlock'
import { PartsContext } from './V2Contexts'

const logger = loggerService.withContext('PartsRenderer')

// ============================================================================
// Animation (shared with MessageBlockRenderer)
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

const AnimatedBlockWrapper: React.FC<{ children: React.ReactNode; enableAnimation: boolean }> = ({
  children,
  enableAnimation
}) => (
  <motion.div
    className="block-wrapper"
    variants={blockWrapperVariants}
    initial={enableAnimation ? 'hidden' : 'static'}
    animate={enableAnimation ? 'visible' : 'static'}>
    <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
  </motion.div>
)

// ============================================================================
// Props
// ============================================================================

interface Props {
  message: Message
}

// ============================================================================
// Helpers
// ============================================================================

/** Check if a part is an image file part. */
function isImageFilePart(part: CherryMessagePart): boolean {
  return (
    part.type === 'file' &&
    'mediaType' in part &&
    typeof part.mediaType === 'string' &&
    part.mediaType.startsWith('image/')
  )
}

/** Check if a part is a tool part (tool-* or dynamic-tool). */
function isToolPart(part: CherryMessagePart): boolean {
  const t = part.type as string
  return t.startsWith('tool-') || t === 'dynamic-tool'
}

/** Check if a part is a video data part. */
function isVideoDataPart(part: CherryMessagePart): boolean {
  return (part.type as string) === 'data-video'
}

/** Get video filePath from a data-video part. */
function getVideoFilePath(part: CherryMessagePart): string | undefined {
  if ((part.type as string) === 'data-video' && 'data' in part) {
    return (part.data as { filePath?: string })?.filePath
  }
  return undefined
}

// ============================================================================
// Part grouping
// ============================================================================

type PartEntry = { part: CherryMessagePart; index: number }
type GroupedEntry = PartEntry | PartEntry[]

function groupSimilarParts(parts: CherryMessagePart[]): GroupedEntry[] {
  const entries: PartEntry[] = parts.map((part, index) => ({ part, index }))

  return entries.reduce<GroupedEntry[]>((acc, entry) => {
    const { part } = entry

    if (isImageFilePart(part)) {
      const prev = acc[acc.length - 1]
      if (Array.isArray(prev) && isImageFilePart(prev[0].part)) {
        prev.push(entry)
      } else {
        acc.push([entry])
      }
    } else if (isToolPart(part)) {
      const prev = acc[acc.length - 1]
      if (Array.isArray(prev) && isToolPart(prev[0].part)) {
        prev.push(entry)
      } else {
        acc.push([entry])
      }
    } else if (isVideoDataPart(part)) {
      const filePath = getVideoFilePath(part)
      const existingGroup = acc.find(
        (g) => Array.isArray(g) && isVideoDataPart(g[0].part) && getVideoFilePath(g[0].part) === filePath
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
 * Render a single part.
 *
 * Data extraction happens HERE — leaf components receive pure view props only.
 * For unmigrated part types, falls back to partToBlock() → legacy Block component.
 */
function renderPart(part: CherryMessagePart, partId: string, message: Message, isStreaming: boolean): React.ReactNode {
  const partType = part.type as string

  switch (partType) {
    case 'reasoning': {
      const reasoningPart = part as { text?: string; providerMetadata?: Record<string, unknown> }
      const cherryMeta = getCherryMeta(part)
      // thinkingMs: prefer cherry.thinkingMs (migration/persisted), fallback to metadata.thinking_millsec (live stream plugin)
      const metadataBlock =
        'providerMetadata' in part && part.providerMetadata
          ? ((part.providerMetadata as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
          : undefined
      const thinkingMs =
        cherryMeta?.thinkingMs ??
        (typeof metadataBlock?.thinking_millsec === 'number' ? metadataBlock.thinking_millsec : 0)
      return (
        <ThinkingBlock
          key={partId}
          id={partId}
          content={reasoningPart.text || ''}
          isStreaming={isStreaming}
          thinkingMs={thinkingMs}
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

    case 'data-translation': {
      const translationData = (part as { data: { content: string } }).data
      return <TranslationBlock key={partId} id={partId} content={translationData.content} isStreaming={isStreaming} />
    }

    case 'source-url':
    case 'step-start':
      return null

    default:
      // Unmigrated part types: fallback to partToBlock() → legacy Block rendering
      // This will be progressively removed as Batch 2/3 migration completes.
      return renderViaLegacyBlock(part, partId, message, isStreaming)
  }
}

/**
 * Fallback: convert part to MessageBlock and render via legacy Block component.
 * Used for part types not yet migrated to direct part consumption.
 */
function renderViaLegacyBlock(
  part: CherryMessagePart,
  partId: string,
  message: Message,
  _isStreaming: boolean
): React.ReactNode {
  const blockStatus = mapMessageStatusToBlockStatus(message.status as string)
  const block = partToBlock(part, partId, message.id, message.createdAt, blockStatus)
  if (!block) return null

  // Import and render legacy block components
  // This uses the same switch pattern as MessageBlockRenderer
  return <LegacyBlockSwitch key={partId} block={block} message={message} />
}

// ============================================================================
// Legacy block fallback (temporary — will shrink as migration progresses)
// ============================================================================

// Lazy imports to avoid circular deps and keep bundle splitting
const CitationBlock = React.lazy(() => import('./CitationBlock'))
const ErrorBlock = React.lazy(() => import('./ErrorBlock'))
const FileBlock = React.lazy(() => import('./FileBlock'))
const ImageBlock = React.lazy(() => import('./ImageBlock'))
const MainTextBlock = React.lazy(() => import('./MainTextBlock'))
const ToolBlock = React.lazy(() => import('./ToolBlock'))
const ToolBlockGroup = React.lazy(() => import('./ToolBlockGroup'))
const VideoBlock = React.lazy(() => import('./VideoBlock'))

const LegacyBlockSwitch: React.FC<{ block: MessageBlock; message: Message }> = ({ block, message }) => {
  switch (block.type) {
    case MessageBlockType.MAIN_TEXT:
    case MessageBlockType.CODE: {
      const mainTextBlock = block as MainTextMessageBlock
      const citationBlockId = mainTextBlock.citationReferences?.[0]?.citationBlockId
      return (
        <React.Suspense fallback={null}>
          <MainTextBlock block={mainTextBlock} citationBlockId={citationBlockId} role={message.role} />
        </React.Suspense>
      )
    }
    case MessageBlockType.IMAGE:
      return (
        <React.Suspense fallback={null}>
          <ImageBlock block={block as ImageMessageBlock} />
        </React.Suspense>
      )
    case MessageBlockType.FILE:
      return (
        <React.Suspense fallback={null}>
          <FileBlock block={block as FileMessageBlock} />
        </React.Suspense>
      )
    case MessageBlockType.TOOL:
      return (
        <React.Suspense fallback={null}>
          <ToolBlock block={block as ToolMessageBlock} />
        </React.Suspense>
      )
    case MessageBlockType.CITATION:
      return (
        <React.Suspense fallback={null}>
          <CitationBlock block={block as CitationMessageBlock} />
        </React.Suspense>
      )
    case MessageBlockType.ERROR:
      return (
        <React.Suspense fallback={null}>
          <ErrorBlock block={block as ErrorMessageBlock} message={message} />
        </React.Suspense>
      )
    case MessageBlockType.VIDEO:
      return (
        <React.Suspense fallback={null}>
          <VideoBlock block={block as VideoMessageBlock} />
        </React.Suspense>
      )
    default:
      logger.warn('Unsupported part type in PartsRenderer fallback', { type: block.type })
      return null
  }
}

// ============================================================================
// Main component
// ============================================================================

const PartsRenderer: React.FC<Props> = ({ message }) => {
  const partsMap = use(PartsContext)
  const messageParts = partsMap?.[message.id]

  const isStreaming = message.status.includes('ing')

  const grouped = useMemo(() => {
    if (!messageParts || messageParts.length === 0) return []
    return groupSimilarParts(messageParts)
  }, [messageParts])

  const isProcessing = isMessageProcessing(message)

  // No parts to render — normal for user messages (content is in message text, not parts)
  if (!messageParts || messageParts.length === 0) {
    return null
  }

  return (
    <AnimatePresence mode="sync">
      {grouped.map((entry) => {
        if (Array.isArray(entry)) {
          // Grouped parts (images, tools, videos)
          const groupKey = entry.map((e) => `${message.id}-part-${e.index}`).join('-')
          const firstPart = entry[0].part

          if (isImageFilePart(firstPart)) {
            // Image group — fallback to legacy for now
            const blockStatus = mapMessageStatusToBlockStatus(message.status as string)
            const blocks = entry
              .map((e) =>
                partToBlock(e.part, `${message.id}-part-${e.index}`, message.id, message.createdAt, blockStatus)
              )
              .filter(Boolean) as MessageBlock[]

            if (blocks.length === 1) {
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
                  <React.Suspense fallback={null}>
                    <ImageBlock block={blocks[0] as ImageMessageBlock} isSingle={true} />
                  </React.Suspense>
                </AnimatedBlockWrapper>
              )
            }
            return (
              <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxWidth: '100%' }}>
                  {blocks.map((b) => (
                    <React.Suspense key={b.id} fallback={null}>
                      <ImageBlock block={b as ImageMessageBlock} isSingle={false} />
                    </React.Suspense>
                  ))}
                </div>
              </AnimatedBlockWrapper>
            )
          }

          if (isToolPart(firstPart)) {
            // Tool group — fallback to legacy
            const blockStatus = mapMessageStatusToBlockStatus(message.status as string)
            const blocks = entry
              .map((e) =>
                partToBlock(e.part, `${message.id}-part-${e.index}`, message.id, message.createdAt, blockStatus)
              )
              .filter(Boolean) as ToolMessageBlock[]

            if (blocks.length === 1) {
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
                  <React.Suspense fallback={null}>
                    <ToolBlock block={blocks[0]} />
                  </React.Suspense>
                </AnimatedBlockWrapper>
              )
            }
            const stableGroupKey = `tool-group-${message.id}-part-${entry[0].index}`
            return (
              <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={isStreaming}>
                <React.Suspense fallback={null}>
                  <ToolBlockGroup blocks={blocks} />
                </React.Suspense>
              </AnimatedBlockWrapper>
            )
          }

          if (isVideoDataPart(firstPart)) {
            // Video group — render first only (dedup by filePath)
            const firstEntry = entry[0]
            const partId = `${message.id}-part-${firstEntry.index}`
            return (
              <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
                {renderPart(firstEntry.part, partId, message, isStreaming)}
              </AnimatedBlockWrapper>
            )
          }

          return null
        }

        // Single part
        const partId = `${message.id}-part-${entry.index}`
        const rendered = renderPart(entry.part, partId, message, isStreaming)
        if (!rendered) return null

        return (
          <AnimatedBlockWrapper key={partId} enableAnimation={isStreaming}>
            {rendered}
          </AnimatedBlockWrapper>
        )
      })}
      {isProcessing && (
        <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
          <PlaceholderBlock
            block={{
              id: `loading-${message.id}`,
              messageId: message.id,
              type: MessageBlockType.UNKNOWN,
              status: MessageBlockStatus.PROCESSING,
              createdAt: new Date().toISOString()
            }}
          />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
}

export default React.memo(PartsRenderer)
