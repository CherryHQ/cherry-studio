import { Scrollbar } from '@cherrystudio/ui'
import { scrollIntoView } from '@renderer/utils/dom'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import React, { useMemo, useRef } from 'react'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { usePartsMap } from '../blocks'
import { createSlugger, extractTextFromNode } from '../markdown/plugins/rehypeHeadingIds'
import type { MessageListItem } from '../types'

interface MessageOutlineProps {
  message: MessageListItem
  multiModelMessageStyle: MultiModelMessageStyle
}

interface HeadingItem {
  id: string
  level: number
  text: string
}

const MessageOutline: FC<MessageOutlineProps> = ({ message, multiModelMessageStyle }) => {
  const partsMap = usePartsMap()

  const headings: HeadingItem[] = useMemo(() => {
    // Collect text contents from parts only
    const textEntries: { id: string; content: string }[] = []
    const messageParts = partsMap?.[message.id]

    if (!messageParts) return []

    let idx = 0
    for (const part of messageParts) {
      if (part.type === 'text' && 'text' in part) {
        const text = part.text.trim()
        if (text.length > 0) {
          textEntries.push({ id: `${message.id}-part-${idx}`, content: text })
        }
      }
      idx++
    }

    if (!textEntries.length) return []

    const result: HeadingItem[] = []
    for (const entry of textEntries) {
      const tree = unified().use(remarkParse).parse(entry.content)
      const slugger = createSlugger()
      visit(tree, ['heading', 'html'], (node) => {
        if (node.type === 'heading') {
          const level = node.depth ?? 0
          if (!level || level < 1 || level > 6) return
          const text = extractTextFromNode(node)
          if (!text) return
          const id = `heading-${entry.id}--` + slugger.slug(text || '')
          result.push({ id, level, text })
        } else if (node.type === 'html') {
          const match = node.value.match(/<h([1-6])[^>]*>(.*?)<\/h\1>/i)
          if (match) {
            const level = parseInt(match[1], 10)
            const text = match[2].replace(/<[^>]*>/g, '').trim()
            if (text) {
              const id = `heading-${entry.id}--${slugger.slug(text || '')}`
              result.push({ id, level, text })
            }
          }
        }
      })
    }

    return result
  }, [partsMap, message.id])

  const miniLevel = useMemo(() => {
    return headings.length ? Math.min(...headings.map((heading) => heading.level)) : 1
  }, [headings])

  const messageOutlineContainerRef = useRef<HTMLDivElement>(null)
  const scrollToHeading = (id: string) => {
    const parent = messageOutlineContainerRef.current?.parentElement
    const messageContentContainer = parent?.querySelector('.message-content-container')
    if (messageContentContainer) {
      const headingElement = messageContentContainer.querySelector<HTMLElement>(`#${id}`)
      if (headingElement) {
        const scrollBlock = ['horizontal', 'grid'].includes(multiModelMessageStyle) ? 'nearest' : 'start'
        scrollIntoView(headingElement, { behavior: 'smooth', block: scrollBlock, container: 'nearest' })
      }
    }
  }

  // 暂时不支持 grid，因为在锚点滚动时会导致渲染错位
  if (multiModelMessageStyle === 'grid' || !headings.length) return null

  return (
    <div
      ref={messageOutlineContainerRef}
      className="pointer-events-none absolute inset-[63px_0_36px_10px] z-999 [&~.MessageFooter]:ml-10! [&~.message-content-container]:pl-11.5!">
      <Scrollbar
        className="group pointer-events-auto sticky bottom-0 inline-flex max-h-[min(100%,70vh)] max-w-1/2 flex-col gap-1 overflow-x-hidden overflow-y-hidden rounded-[10px] border border-transparent px-0 pt-2.5 pr-0 pb-2.5 pl-2.5 hover:overflow-y-auto hover:border-border/40 hover:bg-popover hover:px-2.5 hover:shadow-[0_0_10px_0_rgba(128,128,128,0.2)]"
        style={{
          top: `max(calc(50% - ${Math.floor((headings.length * 24) / 2 + 10)}px), 20px)`
        }}>
        {headings.map((heading, index) => (
          <div
            key={index}
            className="flex h-6 shrink-0 cursor-pointer items-center gap-2 [&:hover_.outline-dot]:bg-foreground-muted [&:hover_.outline-text]:text-foreground-secondary"
            onClick={() => scrollToHeading(heading.id)}>
            <div
              className="mr-1 h-1 shrink-0 rounded-[2px] bg-border outline-dot transition-colors duration-200 ease-out"
              style={{
                width: `${16 - heading.level * 2}px`
              }}
            />
            <div
              className="hidden truncate whitespace-nowrap px-2 py-0.5 text-foreground-muted opacity-0 outline-text transition-opacity duration-200 ease-out group-hover:block group-hover:opacity-100"
              style={{
                fontSize: `${16 - heading.level}px`,
                paddingLeft: `${(heading.level - miniLevel) * 8}px`
              }}>
              {heading.text}
            </div>
          </div>
        ))}
      </Scrollbar>
    </div>
  )
}

export default React.memo(MessageOutline)
