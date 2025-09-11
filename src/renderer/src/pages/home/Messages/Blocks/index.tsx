import { loggerService } from '@logger'
import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { ImageMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { isMainTextBlock, isVideoBlock } from '@renderer/utils/messageUtils/is'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import CitationBlock from './CitationBlock'
import ErrorBlock from './ErrorBlock'
import FileBlock from './FileBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlock from './ToolBlock'
import TranslationBlock from './TranslationBlock'
import VideoBlock from './VideoBlock'

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
      {children}
    </motion.div>
  )
}

interface Props {
  blocks: string[] // 可以接收块ID数组或MessageBlock数组
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
    } else {
      acc.push(currentBlock)
    }
    return acc
  }, [])
}

const MessageBlockRenderer: React.FC<Props> = ({ blocks, message }) => {
  // 始终调用useSelector，避免条件调用Hook
  const blockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))
  // 根据blocks类型处理渲染数据
  const renderedBlocks = blocks.map((blockId) => blockEntities[blockId]).filter(Boolean)
  const groupedBlocks = useMemo(() => groupSimilarBlocks(renderedBlocks), [renderedBlocks])

  return (
    <AnimatePresence mode="sync">
      {groupedBlocks.map((block) => {
        if (Array.isArray(block)) {
          const groupKey = block.map((b) => b.id).join('-')

          if (block[0].type === MessageBlockType.IMAGE) {
            if (block.length === 1) {
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                  <ImageBlock key={block[0].id} block={block[0] as ImageMessageBlock} isSingle={true} />
                </AnimatedBlockWrapper>
              )
            }
            // 多张图片使用 ImageBlockGroup 包装
            return (
              <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                <ImageBlockGroup count={block.length}>
                  {block.map((imageBlock) => (
                    <ImageBlock key={imageBlock.id} block={imageBlock as ImageMessageBlock} isSingle={false} />
                  ))}
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
          }
          return null
        }

        let blockComponent: React.ReactNode = null

        switch (block.type) {
          case MessageBlockType.UNKNOWN:
            if (block.status === MessageBlockStatus.PROCESSING) {
              blockComponent = <PlaceholderBlock key={block.id} block={block} />
            }
            break
          case MessageBlockType.MAIN_TEXT:
          case MessageBlockType.CODE: {
            if (!isMainTextBlock(block)) {
              logger.warn('Expected main text block but got different type', block)
              break
            }
            const mainTextBlock = block
            // Find the associated citation block ID from the references
            const citationBlockId = mainTextBlock.citationReferences?.[0]?.citationBlockId

            blockComponent = (
              <MainTextBlock
                key={block.id}
                block={mainTextBlock}
                // Pass only the ID string
                citationBlockId={citationBlockId}
                role={message.role}
              />
            )
            break
          }
          case MessageBlockType.IMAGE:
            blockComponent = <ImageBlock key={block.id} block={block} />
            break
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
          case MessageBlockType.THINKING:
            blockComponent = <ThinkingBlock key={block.id} block={block} />
            break
          case MessageBlockType.TRANSLATION:
            blockComponent = <TranslationBlock key={block.id} block={block} />
            break
          case MessageBlockType.VIDEO:
            blockComponent = <VideoBlock key={block.id} block={block} />
            break
          default:
            logger.warn('Unsupported block type in MessageBlockRenderer:', (block as any).type, block)
            break
        }

        return (
          <AnimatedBlockWrapper
            key={block.type === MessageBlockType.UNKNOWN ? 'placeholder' : block.id}
            enableAnimation={message.status.includes('ing')}>
            {blockComponent}
          </AnimatedBlockWrapper>
        )
      })}
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
