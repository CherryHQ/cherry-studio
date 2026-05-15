import { LoadingIcon } from '@renderer/components/Icons'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import { useTimer } from '@renderer/hooks/useTimer'
import {
  captureScrollableAsBlob,
  captureScrollableAsDataURL,
  removeSpecialCharactersForFileName
} from '@renderer/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NarrowLayout from '../layout/NarrowLayout'
import { PartsProvider } from './blocks'
import { MessageListInitialLoading } from './layout/MessageListLoading'
import { MessagesContainer } from './layout/shared'
import MessageAnchorLine from './list/MessageAnchorLine'
import MessageGroup from './list/MessageGroup'
import { MessageVirtualList, type MessageVirtualListHandle } from './list/MessageVirtualList'
import SelectionBox from './list/SelectionBox'
import {
  useMessageListActions,
  useMessageListData,
  useMessageListMeta,
  useMessageListParts,
  useMessageListSelection,
  useMessageRenderConfig
} from './MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from './types'

const MULTI_SELECT_BOTTOM_PADDING_PX = 96

function groupMessageListItems(messages: MessageListItem[]): Record<string, MessageListItem[]> {
  const grouped: Record<string, MessageListItem[]> = {}

  for (const message of messages) {
    const key =
      message.role === 'assistant' && message.parentId ? `assistant${message.parentId}` : message.role + message.id
    grouped[key] ??= []
    grouped[key].push(message)
  }

  return grouped
}

const MessageList = () => {
  const data = useMessageListData()
  const partsByMessageId = useMessageListParts()
  const actions = useMessageListActions()
  const meta = useMessageListMeta()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const selection = useMessageListSelection()
  const { topic, messages, beforeList, hasOlder = false, messageNavigation } = data
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const isMultiSelectMode = selection?.isMultiSelectMode ?? false
  const selectedMessageIds = selection?.selectedMessageIds ?? []

  const messageListRef = useRef<MessageVirtualListHandle | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const messageElements = useRef<Map<string, HTMLElement>>(new Map())

  const groupedMessages = useMemo(() => Object.entries(groupMessageListItems(messages)), [messages])

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
      const target = messages.find((m) => m.id === messageId)
      if (!target) return
      const groupKey =
        target.role === 'assistant' && target.parentId ? 'assistant' + target.parentId : target.role + target.id
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
        setTimeoutTimer('message-list-load-older-spinner', () => setIsLoadingMore(false), data.loadingResetDelayMs)
      },
      data.loadOlderDelayMs
    )
  }, [actions, data.loadOlderDelayMs, data.loadingResetDelayMs, hasOlder, isLoadingMore, setTimeoutTimer])

  useEffect(() => {
    scrollContainerRef.current = (messageListRef.current?.getScrollElement() as HTMLDivElement | null) ?? null
  }, [groupedMessages])

  useEffect(() => {
    return actions.bindRuntime?.({
      scrollToBottom,
      copyTopicImage: async () => {
        await captureScrollableAsBlob(scrollContainerRef, async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          }
        })
      },
      exportTopicImage: async () => {
        if (!meta.imageExportFileName || !actions.saveImage) return
        const imageData = await captureScrollableAsDataURL(scrollContainerRef)
        if (imageData) {
          void actions.saveImage(removeSpecialCharactersForFileName(meta.imageExportFileName), imageData)
        }
      }
    })
  }, [actions, meta.imageExportFileName, scrollToBottom])

  if (data.isInitialLoading) {
    return <MessageListInitialLoading />
  }

  return (
    <PartsProvider value={partsByMessageId}>
      <MessagesContainer id="messages" className="messages-container" key={data.listKey}>
        <NarrowLayout
          narrowMode={renderConfig.narrowMode}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {beforeList}
          <SelectionContextMenu>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <MessageVirtualList
                handleRef={messageListRef}
                items={groupedMessages}
                getItemKey={([key]) => key}
                estimateSize={data.estimateSize}
                overscan={data.overscan}
                bottomPadding={isMultiSelectMode ? MULTI_SELECT_BOTTOM_PADDING_PX : undefined}
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
            handleSelectMessage={(messageId, selected) => actions.selectMessage?.(messageId, selected)}
          />
        )}
        <MultiSelectActionPopup
          selectedMessageIds={selectedMessageIds}
          isMultiSelectMode={isMultiSelectMode}
          onSave={
            actions.saveSelectedMessages ? () => void actions.saveSelectedMessages?.(selectedMessageIds) : undefined
          }
          onCopy={
            actions.copySelectedMessages ? () => void actions.copySelectedMessages?.(selectedMessageIds) : undefined
          }
          onDelete={
            actions.deleteSelectedMessages ? () => void actions.deleteSelectedMessages?.(selectedMessageIds) : undefined
          }
          onClose={() => actions.toggleMultiSelectMode?.(false)}
        />
      </MessagesContainer>
    </PartsProvider>
  )
}

export default MessageList
