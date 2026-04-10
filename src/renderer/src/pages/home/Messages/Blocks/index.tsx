import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import FileManager from '@renderer/services/FileManager'
import type { RootState } from '@renderer/store'
import {
  formatCitationsFromBlock,
  messageBlocksSelectors,
  selectFormattedCitationsByBlockId
} from '@renderer/store/messageBlock'
import type { Model } from '@renderer/types'
import type { ImageMessageBlock, MainTextMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { isMainTextBlock, isMessageProcessing, isToolBlock, isVideoBlock } from '@renderer/utils/messageUtils/is'
import { mapMessageStatusToBlockStatus, partToBlock } from '@renderer/utils/partsToBlocks'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { use, useMemo } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import BlockErrorFallback from './BlockErrorFallback'
import CitationBlock from './CitationBlock'
import CompactBlock from './CompactBlock'
import ErrorBlock from './ErrorBlock'
import FileBlock from './FileBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlock from './ToolBlock'
import ToolBlockGroup from './ToolBlockGroup'
import TranslationBlock from './TranslationBlock'
import { PartsContext, useResolveBlock } from './V2Contexts'
import VideoBlock from './VideoBlock'

// Re-export context providers and hooks so existing imports keep working
export {
  PartsProvider,
  resolveBlockFromParts,
  useIsV2Chat,
  useMessageBlocks,
  usePartsMap,
  useResolveBlock
} from './V2Contexts'

const logger = loggerService.withContext('MessageBlockRenderer')

interface AnimatedBlockWrapperProps {
  children: React.ReactNode
  enableAnimation: boolean
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
    opacity: 1,
    x: 0,
    transition: { duration: 0 }
  }
}

const AnimatedBlockWrapper: React.FC<AnimatedBlockWrapperProps> = ({ children, enableAnimation }) => {
  return (
    <motion.div
      className="block-wrapper"
      variants={blockWrapperVariants}
      initial={enableAnimation ? 'hidden' : 'static'}
      animate={enableAnimation ? 'visible' : 'static'}>
      <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
    </motion.div>
  )
}

interface Props {
  blocks: string[]
  messageStatus?: Message['status']
  message: Message
}

const groupSimilarBlocks = (blocks: MessageBlock[]): (MessageBlock[] | MessageBlock)[] => {
  return blocks.reduce((acc: (MessageBlock[] | MessageBlock)[], currentBlock) => {
    if (currentBlock.type === MessageBlockType.IMAGE) {
      // 对于IMAGE类型，按连续分组
      const prevGroup = acc[acc.length - 1]
      if (Array.isArray(prevGroup) && prevGroup[0].type === MessageBlockType.IMAGE) {
        prevGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.VIDEO) {
      // 对于VIDEO类型，按相同filePath分组
      if (!isVideoBlock(currentBlock)) {
        logger.warn('Block type is VIDEO but failed type guard check', currentBlock)
        acc.push(currentBlock)
        return acc
      }
      const videoBlock = currentBlock
      const existingGroup = acc.find(
        (group) =>
          Array.isArray(group) &&
          group[0].type === MessageBlockType.VIDEO &&
          isVideoBlock(group[0]) &&
          group[0].filePath === videoBlock.filePath
      ) as MessageBlock[] | undefined

      if (existingGroup) {
        existingGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.TOOL) {
      // 对于TOOL类型，按连续分组
      const prevGroup = acc[acc.length - 1]
      if (Array.isArray(prevGroup) && prevGroup[0].type === MessageBlockType.TOOL) {
        prevGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else {
      acc.push(currentBlock)
    }
    return acc
  }, [])
}

/**
 * V1 wrapper: resolves citations from Redux/PartsContext and passes pure props to MainTextBlock.
 */
const MainTextBlockWithCitations: React.FC<{
  block: MainTextMessageBlock
  citationBlockId?: string
  role: Message['role']
  mentions?: Model[]
}> = ({ block, citationBlockId, role, mentions }) => {
  const v2CitationBlock = useResolveBlock(citationBlockId)
  const reduxCitations = useSelector((state: RootState) =>
    v2CitationBlock ? [] : selectFormattedCitationsByBlockId(state, citationBlockId)
  )
  const citations = useMemo(() => {
    if (!v2CitationBlock) return reduxCitations
    if (v2CitationBlock.type === MessageBlockType.CITATION) {
      return formatCitationsFromBlock(v2CitationBlock)
    }
    return []
  }, [v2CitationBlock, reduxCitations])

  return (
    <MainTextBlock
      id={block.id}
      content={block.content}
      isStreaming={block.status === MessageBlockStatus.STREAMING}
      citations={citations}
      citationReferences={block.citationReferences}
      role={role}
      mentions={mentions}
    />
  )
}

/** Extract image URLs from an ImageMessageBlock (V1 data). */
function extractImagesFromBlock(block: ImageMessageBlock): string[] {
  if (block.metadata?.generateImageResponse?.images?.length) {
    return block.metadata.generateImageResponse.images
  }
  if (block.file) {
    return [`file://${FileManager.getFilePath(block.file)}`]
  }
  if (block.url) {
    return [block.url]
  }
  return []
}

const MessageBlockRenderer: React.FC<Props> = ({ blocks, message }) => {
  const partsMap = use(PartsContext)
  // Always call useSelector to satisfy hooks-rules (no conditional hooks)
  const reduxBlockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))

  // Priority: PartsContext (convert parts→blocks internally) > Redux fallback
  const renderedBlocks = useMemo(() => {
    const messageParts = partsMap?.[message.id]
    if (messageParts) {
      // Parts-driven: convert parts to blocks inline, no ID lookup needed
      const blockStatus = mapMessageStatusToBlockStatus(message.status as string)
      const converted: MessageBlock[] = []
      for (let i = 0; i < messageParts.length; i++) {
        const blockId = `${message.id}-block-${i}`
        const block = partToBlock(messageParts[i], blockId, message.id, message.createdAt, blockStatus)
        if (block) converted.push(block)
      }
      return converted
    }
    // Redux fallback (V1 mode)
    return blocks.map((blockId) => reduxBlockEntities[blockId]).filter((b): b is MessageBlock => b != null)
  }, [partsMap, message.id, message.status, message.createdAt, reduxBlockEntities, blocks])

  const groupedBlocks = useMemo(() => groupSimilarBlocks(renderedBlocks), [renderedBlocks])

  // Check if message is still processing
  const isProcessing = isMessageProcessing(message)

  return (
    <AnimatePresence mode="sync">
      {groupedBlocks.map((block) => {
        if (Array.isArray(block)) {
          const groupKey = block.map((b) => b.id).join('-')

          if (block[0].type === MessageBlockType.IMAGE) {
            if (block.length === 1) {
              const images = extractImagesFromBlock(block[0])
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                  <ImageBlock
                    key={block[0].id}
                    images={images}
                    isPending={block[0].status === MessageBlockStatus.PENDING}
                    isSingle={true}
                  />
                </AnimatedBlockWrapper>
              )
            }
            // 多张图片使用 ImageBlockGroup 包装
            return (
              <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                <ImageBlockGroup count={block.length}>
                  {block.map((imageBlock) => {
                    const images = extractImagesFromBlock(imageBlock as ImageMessageBlock)
                    return (
                      <ImageBlock
                        key={imageBlock.id}
                        images={images}
                        isPending={imageBlock.status === MessageBlockStatus.PENDING}
                        isSingle={false}
                      />
                    )
                  })}
                </ImageBlockGroup>
              </AnimatedBlockWrapper>
            )
          } else if (block[0].type === MessageBlockType.VIDEO) {
            // 对于相同路径的video，只渲染第一个
            if (!isVideoBlock(block[0])) {
              logger.warn('Expected video block but got different type', block[0])
              return null
            }
            const firstVideoBlock = block[0]
            return (
              <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                <VideoBlock key={firstVideoBlock.id} block={firstVideoBlock} />
              </AnimatedBlockWrapper>
            )
          } else if (block[0].type === MessageBlockType.TOOL) {
            // 对于连续的TOOL，使用分组显示
            if (block.length === 1) {
              // 单个工具调用，直接渲染
              if (!isToolBlock(block[0])) {
                logger.warn('Expected tool block but got different type', block[0])
                return null
              }
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                  <ToolBlock key={block[0].id} block={block[0]} />
                </AnimatedBlockWrapper>
              )
            }
            // 多个工具调用，使用分组组件
            const toolBlocks = block.filter(isToolBlock)
            // Use first block ID as stable key to prevent remounting when new blocks are added
            const stableGroupKey = `tool-group-${toolBlocks[0].id}`
            return (
              <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={message.status.includes('ing')}>
                <ToolBlockGroup blocks={toolBlocks} />
              </AnimatedBlockWrapper>
            )
          }
          return null
        }

        let blockComponent: React.ReactNode = null

        switch (block.type) {
          case MessageBlockType.UNKNOWN:
            break
          case MessageBlockType.MAIN_TEXT:
          case MessageBlockType.CODE: {
            if (!isMainTextBlock(block)) {
              logger.warn('Expected main text block but got different type', block)
              break
            }
            const mainTextBlock = block
            const citationBlockId = mainTextBlock.citationReferences?.[0]?.citationBlockId
            blockComponent = (
              <MainTextBlockWithCitations
                key={block.id}
                block={mainTextBlock}
                citationBlockId={citationBlockId}
                role={message.role}
              />
            )
            break
          }
          case MessageBlockType.IMAGE: {
            const images = extractImagesFromBlock(block)
            blockComponent = (
              <ImageBlock key={block.id} images={images} isPending={block.status === MessageBlockStatus.PENDING} />
            )
            break
          }
          case MessageBlockType.FILE:
            blockComponent = <FileBlock key={block.id} block={block} />
            break
          case MessageBlockType.TOOL:
            blockComponent = <ToolBlock key={block.id} block={block} />
            break
          case MessageBlockType.CITATION:
            blockComponent = <CitationBlock key={block.id} block={block} />
            break
          case MessageBlockType.ERROR:
            blockComponent = <ErrorBlock key={block.id} block={block} message={message} />
            break
          case MessageBlockType.THINKING: {
            const thinkingBlock = block
            blockComponent = (
              <ThinkingBlock
                key={block.id}
                id={block.id}
                content={thinkingBlock.content}
                isStreaming={block.status === MessageBlockStatus.STREAMING}
                thinkingMs={thinkingBlock.thinking_millsec}
              />
            )
            break
          }
          case MessageBlockType.TRANSLATION: {
            const translationBlock = block
            blockComponent = (
              <TranslationBlock
                key={block.id}
                id={block.id}
                content={translationBlock.content}
                isStreaming={block.status === MessageBlockStatus.STREAMING}
              />
            )
            break
          }
          case MessageBlockType.VIDEO:
            blockComponent = <VideoBlock key={block.id} block={block} />
            break
          case MessageBlockType.COMPACT: {
            const compactBlock = block
            blockComponent = (
              <CompactBlock
                key={block.id}
                id={block.id}
                content={compactBlock.content}
                compactedContent={compactBlock.compactedContent}
              />
            )
            break
          }
          default:
            logger.warn('Unsupported block type in MessageBlockRenderer:', (block as any).type, block)
            break
        }

        return (
          <AnimatedBlockWrapper key={block.id} enableAnimation={message.status.includes('ing')}>
            {blockComponent}
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

export default React.memo(MessageBlockRenderer)

const ImageBlockGroup = styled.div<{ count: number }>`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 100%;
`
