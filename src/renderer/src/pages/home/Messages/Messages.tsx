import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { LoadingIcon } from '@renderer/components/Icons'
import { useChatContext } from '@renderer/hooks/useChatContext'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import SelectionBox from '@renderer/pages/home/Messages/SelectionBox'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getContextCount, getGroupedMessages } from '@renderer/services/MessagesService'
import { estimateHistoryTokens } from '@renderer/services/TokenService'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import {
  captureScrollableAsBlob,
  captureScrollableAsDataURL,
  removeSpecialCharactersForFileName,
  runAsyncFunction
} from '@renderer/utils'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import { last } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import InfiniteScroll from 'react-infinite-scroll-component'

import { resolvePartFromParts, usePartsMap } from './Blocks'
import MessageAnchorLine from './MessageAnchorLine'
import MessageGroup from './MessageGroup'
import NarrowLayout from './NarrowLayout'
import Prompt from './Prompt'
import { MessagesContainer, ScrollContainer } from './shared'

interface MessagesProps {
  assistant: Assistant
  topic: Topic
  onComponentUpdate?(): void
  onFirstUpdate?(): void
  messages: Message[]
  /** Trigger loading of the next older branch page from the server. */
  loadOlder?: () => void
  /** Whether older branch pages remain on the server. */
  hasOlder?: boolean
}

const logger = loggerService.withContext('Messages')

const Messages: React.FC<MessagesProps> = ({
  assistant,
  topic,
  onComponentUpdate,
  onFirstUpdate,
  messages,
  loadOlder,
  hasOlder = false
}) => {
  const { containerRef: scrollContainerRef, handleScroll: handleScrollPosition } = useScrollPosition(
    `topic-${topic.id}`
  )
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [showPrompt] = usePreference('chat.message.show_prompt')
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const v2Chat = useV2Chat()
  const { setTimeoutTimer } = useTimer()

  const { isMultiSelectMode, handleSelectMessage } = useChatContext(topic)

  const messageElements = useRef<Map<string, HTMLElement>>(new Map())
  const messagesRef = useRef<Message[]>(messages)
  const partsMapRef = useRef(partsMap)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    partsMapRef.current = partsMap
  }, [partsMap])

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      messageElements.current.set(id, element)
    } else {
      messageElements.current.delete(id)
    }
  }, [])

  // `messages` IS the display list — `useTopicMessagesV2` drives pagination
  // via `useInfiniteQuery` so every loaded message should render. `hasMore`
  // tracks server-side older pages (not a local display window).
  const displayMessages = messages
  const hasMore = hasOlder

  // NOTE: 如果设置为平滑滚动会导致滚动条无法跟随生成的新消息保持在底部位置
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0 })
        }
      })
    }
  }, [scrollContainerRef])

  const clearTopic = useCallback(
    async (data: Topic) => {
      if (data && data.id !== topic.id) {
        return
      }

      await v2Chat?.clearTopicMessages()
    },
    [v2Chat, topic.id]
  )

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, scrollToBottom),
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, async (data: Topic) => {
        window.modal.confirm({
          title: t('chat.input.clear.title'),
          content: t('chat.input.clear.content'),
          centered: true,
          onOk: () => clearTopic(data)
        })
      }),
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
          void window.api.file.saveImage(removeSpecialCharactersForFileName(topic.name), imageData)
        }
      }),
      EventEmitter.on(EVENT_NAMES.NEW_CONTEXT, () => {
        logger.info('[NEW_CONTEXT] Not yet implemented in V2.')
      }),
      EventEmitter.on(
        EVENT_NAMES.EDIT_CODE_BLOCK,
        async (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => {
          const { msgBlockId, codeBlockId, newContent } = data

          try {
            const resolved = partsMapRef.current && resolvePartFromParts(partsMapRef.current, msgBlockId)
            if (resolved && resolved.part.type === 'text') {
              const textPart = resolved.part as { text?: string }
              const updatedText = updateCodeBlock(textPart.text || '', codeBlockId, newContent)
              const allParts = [...(partsMapRef.current![resolved.messageId] || [])]
              allParts[resolved.index] = { ...resolved.part, text: updatedText } as CherryMessagePart
              await dataApiService.patch(`/messages/${resolved.messageId}`, {
                body: { data: { parts: allParts } }
              })
              window.toast.success(t('code_block.edit.save.success'))
              return
            }

            logger.error(
              `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}: unable to resolve part`
            )
            window.toast.error(t('code_block.edit.save.failed.label'))
          } catch (error) {
            logger.error(
              `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}:`,
              error as Error
            )
            window.toast.error(t('code_block.edit.save.failed.label'))
          }
        }
      )
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant, scrollToBottom, topic])

  useEffect(() => {
    void runAsyncFunction(async () => {
      void EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, {
        tokensCount: await estimateHistoryTokens(assistant, messages),
        contextCount: getContextCount(assistant, messages)
      })
    }).then(() => onFirstUpdate?.())
  }, [assistant, messages, onFirstUpdate])

  const loadMoreMessages = useCallback(() => {
    if (!hasMore || isLoadingMore || !loadOlder) return
    setIsLoadingMore(true)
    setTimeoutTimer(
      'loadMoreMessages',
      () => {
        loadOlder()
        setIsLoadingMore(false)
      },
      300
    )
  }, [hasMore, isLoadingMore, loadOlder, setTimeoutTimer])

  useShortcut('chat.copy_last_message', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      const parts = partsMap?.[lastMessage.id]
      const text = parts ? getTextFromParts(parts) : getMainTextContent(lastMessage)
      void navigator.clipboard.writeText(text)
      window.toast.success(t('message.copy.success'))
    }
  })

  useShortcut('chat.edit_last_user_message', () => {
    const lastUserMessage = messagesRef.current.findLast((m) => m.role === 'user' && m.type !== 'clear')
    if (lastUserMessage) {
      void EventEmitter.emit(EVENT_NAMES.EDIT_MESSAGE, lastUserMessage.id)
    }
  })

  useEffect(() => {
    requestAnimationFrame(() => onComponentUpdate?.())
  }, [onComponentUpdate])

  // NOTE: 因为displayMessages是倒序的，所以得到的groupedMessages每个group内部也是倒序的，需要再倒一遍
  const groupedMessages = useMemo(() => {
    const grouped = Object.entries(getGroupedMessages(displayMessages))
    const newGrouped: {
      [key: string]: (Message & {
        index: number
      })[]
    } = {}
    grouped.forEach(([key, group]) => {
      newGrouped[key] = group.toReversed()
    })
    return Object.entries(newGrouped)
  }, [displayMessages])

  return (
    <MessagesContainer
      id="messages"
      className="messages-container"
      ref={scrollContainerRef}
      key={assistant.id}
      onScroll={handleScrollPosition}>
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <InfiniteScroll
          dataLength={displayMessages.length}
          next={loadMoreMessages}
          hasMore={hasMore}
          loader={null}
          scrollableTarget="messages"
          inverse
          style={{ overflow: 'visible' }}>
          <ContextMenu>
            <ScrollContainer>
              {groupedMessages.map(([key, groupMessages]) => (
                <MessageGroup
                  key={key}
                  messages={groupMessages}
                  topic={topic}
                  registerMessageElement={registerMessageElement}
                />
              ))}
              {isLoadingMore && (
                <div
                  className="pointer-events-none flex w-full justify-center py-2.5"
                  style={{ background: 'var(--color-background)' }}>
                  <LoadingIcon color="var(--color-text-2)" />
                </div>
              )}
            </ScrollContainer>
          </ContextMenu>
        </InfiniteScroll>

        {showPrompt && <Prompt assistant={assistant} key={assistant.prompt} topic={topic} />}
      </NarrowLayout>
      {messageNavigation === 'anchor' && <MessageAnchorLine messages={displayMessages} />}
      <SelectionBox
        isMultiSelectMode={isMultiSelectMode}
        scrollContainerRef={scrollContainerRef}
        messageElements={messageElements.current}
        handleSelectMessage={handleSelectMessage}
      />
    </MessagesContainer>
  )
}

// `computeDisplayMessages` was a client-side windowing helper used when
// `Messages` synced its own `displayMessages` state from the `messages`
// prop. With `useInfiniteQuery` driving pagination upstream, `messages`
// IS the visible list, so the helper was removed.

export default Messages
