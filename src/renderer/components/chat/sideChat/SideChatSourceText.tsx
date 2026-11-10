import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useMessageParts, useMessagePartsScopeId } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useSideChats } from '@renderer/hooks/useSideChats'
import { locateSideChatSource } from '@renderer/utils/sideChatAnchor'

import { useSideChatContext } from './SideChatContext'

export function SideChatSourceText({
  text,
  sourceText = text,
  sourceOffset = 0,
  renderText = (start, end) => text.slice(start, end)
}: {
  text: string
  sourceText?: string
  sourceOffset?: number
  renderText?: (start: number, end: number) => ReactNode
}) {
  const context = useSideChatContext()
  const messageId = useMessagePartsScopeId()
  const parts = useMessageParts(messageId ?? '')
  const views = useSideChats(context?.sourceTopicId)
  const current = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const matches = context
    ? views.filter(
        (candidate) =>
          candidate.metadata.snapshot.messageId === messageId &&
          locateSideChatSource(current, candidate.metadata.snapshot) !== null &&
          sourceText.includes(candidate.metadata.snapshot.selection)
      )
    : []
  const ranges: { start: number; end: number; topicIds: string[] }[] = []
  for (const view of matches) {
    const quote = view.metadata.snapshot.selection
    const offset = sourceText.indexOf(quote) - sourceOffset
    const start = Math.max(0, offset)
    const end = Math.min(text.length, offset + quote.length)
    if (start < end) ranges.push({ start, end, topicIds: [view.topicId] })
  }
  ranges.sort((a, b) => a.start - b.start)
  const merged: typeof ranges = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && previous.end > range.start) {
      previous.end = Math.max(previous.end, range.end)
      previous.topicIds.push(...range.topicIds)
    } else merged.push(range)
  }
  const content: ReactNode[] = []
  let cursor = 0
  for (const range of merged) {
    content.push(renderText(cursor, range.start))
    content.push(
      <SideChatSourceLink key={range.start} topicIds={range.topicIds}>
        {renderText(range.start, range.end)}
      </SideChatSourceLink>
    )
    cursor = range.end
  }
  content.push(renderText(cursor, text.length))
  return <>{content}</>
}
function SideChatSourceLink({ topicIds, children }: { topicIds: string[]; children: ReactNode }) {
  const context = useSideChatContext()!
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const trigger = (
    <Button
      data-side-chat-entry
      variant="link"
      className="inline! h-auto rounded-none p-0 text-inherit underline decoration-dotted whitespace-pre-wrap select-text"
      style={{ font: 'inherit' }}
      aria-label={t('side_chat.title')}
      onClick={(event) => {
        if (window.getSelection()?.toString()) {
          event.preventDefault()
          return
        }
        if (topicIds.length === 1) context.open(topicIds[0])
      }}>
      {children}
    </Button>
  )
  if (topicIds.length === 1) return trigger
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="flex w-52 flex-col p-1">
        {topicIds.map((topicId, index) => (
          <Button
            key={topicId}
            variant="ghost"
            className="justify-start"
            onClick={() => {
              context.open(topicId)
              setOpen(false)
            }}>
            {t('side_chat.title')} {index + 1}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
