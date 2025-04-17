import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { Model } from '@renderer/types'
import type {
  CitationMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  Message,
  MessageBlock,
  ThinkingMessageBlock,
  TranslationMessageBlock,
  WebSearchMessageBlock
} from '@renderer/types/newMessageTypes'
import { MessageBlockType } from '@renderer/types/newMessageTypes'
import React from 'react'
import { useSelector } from 'react-redux'

import CitationBlock from './CitationBlock'
import ErrorBlock from './ErrorBlock'
import FileBlock from './FileBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import ThinkingBlock from './ThinkingBlock'
import TranslationBlock from './TranslationBlock'
import WebSearchBlock from './WebSearchBlock'
interface Props {
  blocks: MessageBlock[] | string[] // 可以接收块ID数组或MessageBlock数组
  model?: Model
  messageStatus?: Message['status']
  message: Message
}

const MessageBlockRenderer: React.FC<Props> = ({ blocks, model, message }) => {
  // 始终调用useSelector，避免条件调用Hook
  const blockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))
  if (!blocks || blocks.length === 0) return null

  // 判断blocks是否为ID数组
  const isBlockIds = typeof blocks[0] === 'string'

  // 根据blocks类型处理渲染数据
  const renderedBlocks = isBlockIds
    ? ((blocks as string[]).map((blockId) => blockEntities[blockId]).filter(Boolean) as MessageBlock[])
    : (blocks as MessageBlock[])

  return (
    <>
      {renderedBlocks.map((block) => {
        const citationBlock = block.type === MessageBlockType.CITATION ? (block as CitationMessageBlock) : undefined
        switch (block.type) {
          case MessageBlockType.MAIN_TEXT:
          case MessageBlockType.CODE:
            return (
              <MainTextBlock
                key={block.id}
                block={block}
                model={model}
                citationsBlock={citationBlock}
                message={message}
              />
            )
          case MessageBlockType.IMAGE:
            return <ImageBlock key={block.id} block={block as ImageMessageBlock} />
          case MessageBlockType.FILE:
            return <FileBlock key={block.id} block={block as FileMessageBlock} />
          // case MessageBlockType.TOOL:
          //   return <ToolBlock key={block.id} block={block as ToolBlock} />
          case MessageBlockType.CITATION:
            return <CitationBlock key={block.id} block={block} model={model} />
          case MessageBlockType.WEB_SEARCH:
            return <WebSearchBlock key={block.id} block={block as WebSearchMessageBlock} />
          case MessageBlockType.ERROR:
            return <ErrorBlock key={block.id} block={block as ErrorMessageBlock} />
          case MessageBlockType.THINKING:
            return <ThinkingBlock key={block.id} block={block as ThinkingMessageBlock} />
          // case MessageBlockType.CODE:
          //   return <CodeBlock key={block.id} block={block as CodeMessageBlock} />
          case MessageBlockType.TRANSLATION:
            return <TranslationBlock key={block.id} block={block as TranslationMessageBlock} />
          default:
            console.warn('Unsupported block type in MessageBlockRenderer:', block.type, block)
            return null
        }
      })}
    </>
  )
}

export default React.memo(MessageBlockRenderer)
