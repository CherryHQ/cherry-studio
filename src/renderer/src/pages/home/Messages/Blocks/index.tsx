import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type {
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  MessageBlock,
  PlaceholderMessageBlock,
  ThinkingMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import React from 'react'
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

interface Props {
  blocks: MessageBlock[] | string[] // 可以接收块ID数组或MessageBlock数组
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
  const groupedBlocks = filterImageBlockGroups(renderedBlocks)

  return (
    <>
      {groupedBlocks.map((block) => {
        if (Array.isArray(block)) {
          return (
            <ImageBlockGroup key={block.map((imageBlock) => imageBlock.id).join('-')}>
              {block.map((imageBlock) => (
                <ImageBlock key={imageBlock.id} block={imageBlock as ImageMessageBlock} />
              ))}
            </ImageBlockGroup>
          )
        }

        switch (block.type) {
          case MessageBlockType.UNKNOWN:
            if (block.status === MessageBlockStatus.PROCESSING) {
              return <PlaceholderBlock key={block.id} block={block as PlaceholderMessageBlock} />
            }
            return null
          case MessageBlockType.MAIN_TEXT:
          case MessageBlockType.CODE: {
            const mainTextBlock = block as MainTextMessageBlock
            // Find the associated citation block ID from the references
            const citationBlockId = mainTextBlock.citationReferences?.[0]?.citationBlockId
            // No longer need to retrieve the full citation block here
            // const citationBlock = citationBlockId ? (blockEntities[citationBlockId] as CitationMessageBlock) : undefined

            return (
              <MainTextBlock
                key={block.id}
                block={mainTextBlock}
                // Pass only the ID string
                citationBlockId={citationBlockId}
                role={message.role}
              />
            )
          }
          case MessageBlockType.IMAGE:
            return <ImageBlock key={block.id} block={block as ImageMessageBlock} />
          case MessageBlockType.FILE:
            return <FileBlock key={block.id} block={block as FileMessageBlock} />
          case MessageBlockType.TOOL:
            return <ToolBlock key={block.id} block={block} />
          case MessageBlockType.CITATION:
            return <CitationBlock key={block.id} block={block} />
          case MessageBlockType.ERROR:
            return <ErrorBlock key={block.id} block={block as ErrorMessageBlock} />
          case MessageBlockType.THINKING:
            return <ThinkingBlock key={block.id} block={block as ThinkingMessageBlock} />
          // case MessageBlockType.CODE:
          //   return <CodeBlock key={block.id} block={block as CodeMessageBlock} />
          case MessageBlockType.TRANSLATION:
            return <TranslationBlock key={block.id} block={block as TranslationMessageBlock} />
          default:
            // Cast block to any for console.warn to fix linter error
            console.warn('Unsupported block type in MessageBlockRenderer:', (block as any).type, block)
            return null
        }
      })}
    </>
  )
}

export default React.memo(MessageBlockRenderer)

const ImageBlockGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 8px 0;
  > * {
    flex: 0 0 auto;
    min-width: 200px;
    max-width: calc(33.33% - 8px);
  }
`
