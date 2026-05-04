/**
 * PartsRenderer — V2 replacement for MessageBlockRenderer.
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
import { FILE_TYPE } from '@renderer/types/file'
import type { Message } from '@renderer/types/newMessage'
import { isMessageProcessing } from '@renderer/utils/messageUtils/is'
import { convertReferencesToCitations, convertReferencesToLegacyCitations } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart, ContentReference, ReasoningUIPart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ErrorPartData, VideoPartData } from '@shared/data/types/uiParts'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { use, useMemo } from 'react'

import MessageAttachments from '../MessageAttachments'
import MessageVideo from '../MessageVideo'
import MessageTools from '../Tools/MessageTools'
import { buildToolResponseFromPart, type ToolRenderItem } from '../Tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import ErrorBlock from './ErrorBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlockGroup from './ToolBlockGroup'
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
      // Citation data is embedded in MainTextBlock.citationReferences — no standalone render needed in V2
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

      logger.warn('Unknown part type in PartsRenderer', { type: partType })
      return null
    }
  }
}

/**
 * Render a single tool part by converting directly to ToolResponseLike.
 * Bypasses the partToBlock → ToolMessageBlock → getToolResponseFromBlock roundtrip.
 */
function renderToolPart(part: CherryMessagePart, partId: string): React.ReactNode {
  const toolResponse = buildToolResponseFromPart(part, partId)
  if (!toolResponse) return null
  return <MessageTools key={partId} toolResponse={toolResponse} />
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
  // But if the message is processing (pending/streaming), show the loading placeholder
  if (!messageParts || messageParts.length === 0) {
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
            // Build ToolRenderItems directly from parts — no MessageBlock intermediary
            const toolItems = entry
              .map((e): ToolRenderItem | null => {
                const id = `${message.id}-part-${e.index}`
                const toolResponse = buildToolResponseFromPart(e.part, id)
                return toolResponse ? { id, toolResponse } : null
              })
              .filter((item): item is ToolRenderItem => item !== null)

            if (toolItems.length === 0) return null

            if (toolItems.length === 1) {
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
                  <MessageTools toolResponse={toolItems[0].toolResponse} />
                </AnimatedBlockWrapper>
              )
            }
            const stableGroupKey = `tool-group-${message.id}-part-${entry[0].index}`
            return (
              <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={isStreaming}>
                <ToolBlockGroup items={toolItems} />
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

export default React.memo(PartsRenderer)
