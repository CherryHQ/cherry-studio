import { LoadingIcon } from '@renderer/components/Icons'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import type { Message } from '@renderer/types/newMessage'
import {
  captureScrollableAsBlob,
  captureScrollableAsDataURL,
  removeSpecialCharactersForFileName
} from '@renderer/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NarrowLayout from './layout/NarrowLayout'
import { MessagesContainer } from './layout/shared'
import MessageAnchorLine from './list/MessageAnchorLine'
import MessageGroup from './list/MessageGroup'
import { MessageVirtualList, type MessageVirtualListHandle } from './list/MessageVirtualList'
import SelectionBox from './list/SelectionBox'
import { useMessageList } from './MessageListProvider'

const MessageList = () => {
  const { state, actions, meta } = useMessageList()
  const { topic, messages, beforeList, hasOlder = false, messageNavigation } = state
  const { isMultiSelectMode, handleSelectMessage } = useChatContext(topic)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { setTimeoutTimer } = useTimer()

  const messageListRef = useRef<MessageVirtualListHandle | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const messageElements = useRef<Map<string, HTMLElement>>(new Map())

  const groupedMessages = useMemo(() => Object.entries(getGroupedMessages(messages)), [messages])

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      messageElements.current.set(id, element)
    } else {
      messageElements.current.delete(id)
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    messageListRef.current?.scrollToBottom('instant')
  }, [])

  const scrollToMessageById = useCallback(
    (messageId: string) => {
      const target = messages.find((m: Message) => m.id === messageId)
      if (!target) return
      const groupKey =
        target.role === 'assistant' && target.askId ? 'assistant' + target.askId : target.role + target.id
      messageListRef.current?.scrollToKey(groupKey, 'start')
    },
    [messages]
  )

  const loadMoreMessages = useCallback(() => {
    if (!hasOlder || isLoadingMore || !actions.loadOlder) return
    setIsLoadingMore(true)
    setTimeoutTimer(
      'message-list-load-older',
      () => {
        actions.loadOlder?.()
        setTimeoutTimer('message-list-load-older-spinner', () => setIsLoadingMore(false), state.loadingResetDelayMs)
      },
      state.loadOlderDelayMs
    )
  }, [actions, hasOlder, isLoadingMore, setTimeoutTimer, state.loadOlderDelayMs, state.loadingResetDelayMs])

  useEffect(() => {
    scrollContainerRef.current = (messageListRef.current?.getScrollElement() as HTMLDivElement | null) ?? null
  }, [groupedMessages])

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, scrollToBottom)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [scrollToBottom])

  useEffect(() => {
    if (!meta.imageExportFileName) return

    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.COPY_TOPIC_IMAGE, async () => {
        await captureScrollableAsBlob(scrollContainerRef, async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          }
        })
      }),
      EventEmitter.on(EVENT_NAMES.EXPORT_TOPIC_IMAGE, async () => {
        const imageData = await captureScrollableAsDataURL(scrollContainerRef)
        if (imageData) {
          void window.api.file.saveImage(removeSpecialCharactersForFileName(meta.imageExportFileName!), imageData)
        }
      })
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [meta.imageExportFileName])

  if (state.isInitialLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingIcon color="var(--color-foreground-secondary)" />
      </div>
    )
  }

  return (
    <MessagesContainer id="messages" className="messages-container" key={state.listKey}>
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {beforeList}
        <SelectionContextMenu>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <MessageVirtualList
              handleRef={messageListRef}
              items={groupedMessages}
              getItemKey={([key]) => key}
              estimateSize={state.estimateSize}
              overscan={state.overscan}
              hasMoreTop={hasOlder}
              onReachTop={loadMoreMessages}
              renderItem={([key, groupMessages]) => (
                <MessageGroup
                  key={key}
                  messages={groupMessages}
                  topic={topic}
                  registerMessageElement={registerMessageElement}
                />
              )}
              style={{ flex: 1, minHeight: 0 }}
            />
            {isLoadingMore && (
              <div
                className="pointer-events-none flex w-full justify-center py-2.5"
                style={{ background: 'var(--color-background)' }}>
                <LoadingIcon color="var(--color-foreground-secondary)" />
              </div>
            )}
          </div>
        </SelectionContextMenu>
      </NarrowLayout>
      {messageNavigation === 'anchor' && (
        <MessageAnchorLine
          messages={messages}
          scrollToMessageId={scrollToMessageById}
          scrollToBottom={scrollToBottom}
        />
      )}
      {meta.selectionLayer && (
        <SelectionBox
          isMultiSelectMode={isMultiSelectMode}
          scrollContainerRef={scrollContainerRef as React.RefObject<HTMLDivElement>}
          messageElements={messageElements.current}
          handleSelectMessage={handleSelectMessage}
        />
      )}
    </MessagesContainer>
  )
}

export default MessageList
