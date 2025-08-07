import { loggerService } from '@logger'
import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { ImageMessageBlock, MainTextMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { AnimatePresence, motion } from 'motion/react'
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

const logger = loggerService.withContext('MessageBlockRenderer')

interface AnimatedBlockWrapperProps {
  children: React.ReactNode
  enableAnimation: boolean
}

const blockWrapperVariants = {
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

const filterImageBlockGroups = (blocks: MessageBlock[]): (MessageBlock[] | MessageBlock)[] => {
  return blocks.reduce((acc: (MessageBlock[] | MessageBlock)[], currentBlock) => {
    if (currentBlock.type === MessageBlockType.IMAGE) {
      const prevGroup = acc[acc.length - 1]
      if (Array.isArray(prevGroup) && prevGroup[0].type === MessageBlockType.IMAGE) {
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

const MessageBlockRenderer: React.FC<Props> = ({ blocks, message }) => {
  // 始终调用useSelector，避免条件调用Hook
  const blockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))
  // 根据blocks类型处理渲染数据
  const renderedBlocks = blocks.map((blockId) => blockEntities[blockId]).filter(Boolean)
  const groupedBlocks = useMemo(() => filterImageBlockGroups(renderedBlocks), [renderedBlocks])
  return (
    <AnimatePresence mode="sync">
      {groupedBlocks.map((block) => {
        if (Array.isArray(block)) {
          const groupKey = block.map((imageBlock) => imageBlock.id).join('-')
          return (
            <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
              <ImageBlockGroup count={block.length}>
                {block.map((imageBlock) => (
                  <ImageBlock key={imageBlock.id} block={imageBlock as ImageMessageBlock} />
                ))}
              </ImageBlockGroup>
            </AnimatedBlockWrapper>
          )
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
            const mainTextBlock = block as MainTextMessageBlock
            // Find the associated citation block ID from the references
            const citationBlockId = mainTextBlock.citationReferences?.[0]?.citationBlockId
            // No longer need to retrieve the full citation block here
            // const citationBlock = citationBlockId ? (blockEntities[citationBlockId] as CitationMessageBlock) : undefined

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
  display: grid;
  grid-template-columns: repeat(${({ count }) => Math.min(count, 3)}, minmax(200px, 1fr));
  gap: 8px;
  max-width: 960px;
`
