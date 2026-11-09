import { Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useLayoutEffect, useRef } from 'react'

import { ScrollArea } from '@cherrystudio/ui'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import { MessageContentProvider } from '@renderer/components/chat/messages/MessageContentProvider'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { Assistant } from '@renderer/types/assistant'
import type { CherryMessagePart } from '@shared/data/types/message'

import MessageItem from './Message'

interface Props {
  assistant: Assistant | null
  route: string
  isOutputted: boolean
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const Messages: FC<Props> = ({ assistant, route, isOutputted, messages, partsByMessageId }) => {
  const { renderConfig } = useMessageListRenderConfig()
  const platformActions = useMessagePlatformActions()
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)
  const scrollKey = assistant?.id ?? 'runtime-default'

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    followsLatest.current = true
    const followLatest = () => {
      if (followsLatest.current) viewport.scrollTop = viewport.scrollHeight
    }
    followLatest()
    const observer = new ResizeObserver(followLatest)
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollKey])

  return (
    <MessageContentProvider
      messages={messages}
      partsByMessageId={partsByMessageId}
      renderConfig={renderConfig}
      actions={platformActions}>
      <ScrollArea
        key={scrollKey}
        type="hover"
        className="w-full flex-1 bg-transparent!"
        viewportProps={{
          id: 'messages',
          ref: viewportRef,
          className: 'overflow-x-hidden [overflow-anchor:none]',
          onScroll: ({ currentTarget }) => {
            const { scrollHeight, scrollTop, clientHeight } = currentTarget
            followsLatest.current = scrollHeight - scrollTop - clientHeight <= 2
          }
        }}
        contentProps={{ ref: contentRef, className: 'flex min-h-full flex-col items-center justify-end pb-5' }}>
        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            index={messages.length - index - 1}
            total={messages.length}
            route={route}
          />
        ))}
        {!isOutputted && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </ScrollArea>
    </MessageContentProvider>
  )
}

export default Messages
