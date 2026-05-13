/**
 * MessagePartsRenderer — message parts renderer.
 *
 * Routes CherryMessagePart[] directly to leaf components, bypassing
 * the legacy MessageBlock type system entirely. No intermediate
 * MessageBlock conversion — each part type is rendered from its raw data.
 *
 * Grouping logic:
 * - Consecutive file parts with image mediaType → ImageGroup
 * - Consecutive tool-* / dynamic-tool parts → ToolBlockGroup
 * - data-video parts with same filePath → VideoGroup
 */

import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { FILE_TYPE } from '@renderer/types/file'
import type { Message } from '@renderer/types/newMessage'
import { isMessageAwaitingApproval, isMessageProcessing } from '@renderer/utils/messageUtils/is'
import { convertReferencesToCitations, convertReferencesToLegacyCitations } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart, ContentReference, ReasoningUIPart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ErrorPartData, VideoPartData } from '@shared/data/types/uiParts'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useMemo } from 'react'

import MessageAttachments from '../frame/MessageAttachments'
import MessageVideo from '../frame/MessageVideo'
import MessageTools from '../tools/MessageTools'
import { buildToolResponseFromPart, type ToolRenderItem } from '../tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import ErrorBlock from './ErrorBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import { useMessageParts } from './MessagePartsContext'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlockGroup from './ToolBlockGroup'
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

const AnimatedBlockWrapper: React.FC<{ children: React.ReactNode; enableAnimation: boolean }> = ({
  children,
  enableAnimation
}) => {
  if (!enableAnimation) {
    return (
      <div className="block-wrapper">
        <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
      </div>
    )
  }
  return (
    <motion.div className="block-wrapper" variants={blockWrapperVariants} initial="hidden" animate="visible">
      <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
    </motion.div>
  )
}

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

/** Extract image URL from a file part. */
function extractImageUrl(part: CherryMessagePart): string | undefined {
  if (part.type !== 'file' || !('url' in part)) return undefined
  const filePart = part as { url?: string; mediaType?: string }
  return filePart.url || undefined
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
  message: Message
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
function renderPart(part: CherryMessagePart, partId: string, message: Message, isStreaming: boolean): React.ReactNode {
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
      return (
        <ThinkingBlock
          key={partId}
          id={partId}
          content={reasoningPart.text || ''}
          isStreaming={reasoningPart.state === 'streaming'}
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

    case 'text': {
      const textPart = part as { text?: string }
      const cherryMeta = getCherryMeta(part)
      const citations = cherryMeta?.references
        ? convertReferencesToCitations(cherryMeta.references as ContentReference[])
        : []
      const citationReferences = cherryMeta?.references
        ? convertReferencesToLegacyCitations(cherryMeta.references as ContentReference[], partId)
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
      // Handle tool-* parts (from useChat streaming) and dynamic-tool
      if (partType.startsWith('tool-') || partType === 'dynamic-tool') {
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

interface ToolGroupEntryShape {
  part: CherryMessagePart
  index: number
}
const ToolGroupView = React.memo(
  function ToolGroupView({ entries, messageId }: { entries: readonly ToolGroupEntryShape[]; messageId: string }) {
    const toolItems = entries.flatMap((e): ToolRenderItem[] => {
      const id = `${messageId}-part-${e.index}`
      const toolResponse = buildToolResponseFromPart(e.part, id)
      return toolResponse ? [{ id, toolResponse }] : []
    })
    if (toolItems.length === 0) return null
    if (toolItems.length === 1) return <MessageTools toolResponse={toolItems[0].toolResponse} />
    return <ToolBlockGroup items={toolItems} />
  },
  (prev, next) => {
    if (prev.messageId !== next.messageId) return false
    if (prev.entries.length !== next.entries.length) return false
    for (let i = 0; i < prev.entries.length; i++) {
      if (prev.entries[i].part !== next.entries[i].part) return false
      if (prev.entries[i].index !== next.entries[i].index) return false
    }
    return true
  }
)

// ============================================================================
// Main component
// ============================================================================

const MessagePartsRenderer: React.FC<Props> = ({ message }) => {
  const messageParts = useMessageParts(message.id)

  const { isPending: isTopicStreaming } = useTopicStreamStatus(message.topicId)
  const isStreaming = isTopicStreaming && message.status === 'pending'

  const grouped = useMemo(() => {
    if (messageParts.length === 0) return []
    return groupSimilarParts(messageParts)
  }, [messageParts])

  // Beat loader visible while the assistant turn is still active —
  // either streaming (status pending/processing/searching) or paused
  // on a tool-approval-request waiting for the user. The latter is
  // semantically "expecting input", which the loader's pulse conveys
  // better than "frozen with no UI cue".
  const isProcessing = isMessageProcessing(message) || isMessageAwaitingApproval(message)

  // No parts to render — normal for user messages (content is in message text, not parts)
  // But if the message is processing (pending/streaming), show the loading placeholder
  if (messageParts.length === 0) {
    if (isProcessing) {
      return (
        <AnimatePresence mode="sync">
          <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
            <PlaceholderBlock isProcessing={true} />
          </AnimatedBlockWrapper>
        </AnimatePresence>
      )
    }
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
            // Extract image URLs directly from file parts
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

          if (isToolPart(firstPart)) {
            const stableGroupKey = `tool-group-${message.id}-part-${entry[0].index}`
            return (
              <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={isStreaming}>
                <ToolGroupView entries={entry} messageId={message.id} />
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
          <PlaceholderBlock isProcessing={true} />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
}

export default React.memo(MessagePartsRenderer)
