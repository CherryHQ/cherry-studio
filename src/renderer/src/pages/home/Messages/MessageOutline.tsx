import Scrollbar from '@renderer/components/Scrollbar'
import { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { Message, MessageBlockType } from '@renderer/types/newMessage'
import React, { FC, useMemo, useRef } from 'react'
import { useSelector } from 'react-redux'
import remarkParse from 'remark-parse'
import styled from 'styled-components'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { createSlugger, extractTextFromNode } from '../Markdown/plugins/rehypeHeadingIds'

interface MessageOutlineProps {
  message: Message
}

interface HeadingItem {
  id: string
  level: number
  text: string
}

const MessageOutline: FC<MessageOutlineProps> = ({ message }) => {
  const blockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))

  const headings: HeadingItem[] = useMemo(() => {
    const mainTextBlocks = message.blocks
      .map((blockId) => blockEntities[blockId])
      .filter((b) => b?.type === MessageBlockType.MAIN_TEXT)

    if (!mainTextBlocks?.length) return []

    const result: HeadingItem[] = []
    mainTextBlocks.forEach((mainTextBlock) => {
      const tree = unified().use(remarkParse).parse(mainTextBlock?.content)
      const slugger = createSlugger()
      visit(tree, ['heading', 'html'], (node) => {
        if (node.type === 'heading') {
          const level = node.depth ?? 0
          if (!level || level < 1 || level > 6) return
          const text = extractTextFromNode(node)
          if (!text) return
          const id = `heading-${mainTextBlock.id}--` + slugger.slug(text || '')
          result.push({ id, level, text: text })
        } else if (node.type === 'html') {
          // 匹配 <h1>...</h1> 到 <h6>...</h6>
          const match = node.value.match(/<h([1-6])[^>]*>(.*?)<\/h\1>/i)
          if (match) {
            const level = parseInt(match[1], 10)
            const text = match[2].replace(/<[^>]*>/g, '').trim() // 移除内部的HTML标签
            if (text) {
              const id = `heading-${mainTextBlock.id}--${slugger.slug(text || '')}`
              result.push({ id, level, text })
            }
          }
        }
      })
    })

    return result
  }, [message.blocks, blockEntities])

  const miniLevel = useMemo(() => {
    return headings.length ? Math.min(...headings.map((heading) => heading.level)) : 1
  }, [headings])

  const messageOutlineContainerRef = useRef<HTMLDivElement>(null)
  const scrollToHeading = (id: string) => {
    const parent = messageOutlineContainerRef.current?.parentElement
    const messageContentContainer = parent?.querySelector('.message-content-container')
    if (messageContentContainer) {
      const headingElement = messageContentContainer.querySelector(`#${id}`)
      if (headingElement) {
        const scrollBlock = ['horizontal', 'grid'].includes(message.multiModelMessageStyle ?? '') ? 'nearest' : 'start'
        headingElement.scrollIntoView({ behavior: 'smooth', block: scrollBlock })
      }
    }
  }

  // 暂时不支持 grid，因为在锚点滚动时会导致渲染错位
  if (message.multiModelMessageStyle === 'grid' || !headings.length) return null

  return (
    <MessageOutlineContainer ref={messageOutlineContainerRef}>
      <MessageOutlineBody $count={headings.length}>
        {headings.map((heading, index) => (
          <MessageOutlineItem key={index} onClick={() => scrollToHeading(heading.id)}>
            <MessageOutlineItemDot $level={heading.level} />
            <MessageOutlineItemText $level={heading.level} $miniLevel={miniLevel}>
              {heading.text}
            </MessageOutlineItemText>
          </MessageOutlineItem>
        ))}
      </MessageOutlineBody>
    </MessageOutlineContainer>
  )
}

const MessageOutlineContainer = styled.div`
  position: absolute;
  inset: 63px 0 36px 10px;
  z-index: 999;
  pointer-events: none;
  & ~ .message-content-container {
    padding-left: 46px !important;
  }
  & ~ .MessageFooter {
    margin-left: 46px !important;
  }
`

const MessageOutlineItemDot = styled.div<{ $level: number }>`
  width: ${({ $level }) => 16 - $level * 2}px;
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  margin-right: 4px;
  flex-shrink: 0;
  transition: background 0.2s ease;
`

const MessageOutlineItemText = styled.div<{ $level: number; $miniLevel: number }>`
  overflow: hidden;
  color: var(--color-text-3);
  opacity: 0;
  display: none;
  transition: opacity 0.2s ease;
  padding: 2px 8px;
  padding-left: ${({ $level, $miniLevel }) => ($level - $miniLevel) * 8}px;
  font-size: ${({ $level }) => 16 - $level}px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const MessageOutlineItem = styled.div`
  height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex-shrink: 0;
  &:hover {
    ${MessageOutlineItemText} {
      color: var(--color-text-2);
    }
    ${MessageOutlineItemDot} {
      background: var(--color-text-3);
    }
  }
`

const MessageOutlineBody = styled(Scrollbar)<{ $count: number }>`
  max-width: 50%;
  max-height: min(100%, 70vh);
  position: sticky;
  top: max(calc(50% - ${({ $count }) => ($count * 24) / 2 + 10}px), 20px);
  bottom: 0;
  overflow-x: hidden;
  overflow-y: hidden;
  display: inline-flex;
  flex-direction: column;
  padding: 10px 0 10px 10px;
  gap: 4px;
  border-radius: 10px;
  pointer-events: auto;
  &:hover {
    padding: 10px 10px 10px 10px;
    overflow-y: auto;
    background: var(--color-background);
    box-shadow: 0 0 10px 0 rgba(128, 128, 128, 0.2);
    ${MessageOutlineItemText} {
      opacity: 1;
      display: block;
    }
  }
`

export default React.memo(MessageOutline)
