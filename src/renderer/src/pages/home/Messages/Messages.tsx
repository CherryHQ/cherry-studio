import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { LoadingIcon } from '@renderer/components/Icons'
import { LOAD_MORE_COUNT } from '@renderer/config/constant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicMutations } from '@renderer/hooks/useTopicDataApi'
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
  setActiveTopic: (topic: Topic) => void
  onComponentUpdate?(): void
  onFirstUpdate?(): void
  messages: Message[]
}

const logger = loggerService.withContext('Messages')

const Messages: React.FC<MessagesProps> = ({
  assistant,
  topic,
  setActiveTopic,
  onComponentUpdate,
  onFirstUpdate,
  messages
}) => {
  const { containerRef: scrollContainerRef, handleScroll: handleScrollPosition } = useScrollPosition(
    `topic-${topic.id}`
  )
  const [displayMessages, setDisplayMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { createTopic } = useTopicMutations()
  const [showPrompt] = usePreference('chat.message.show_prompt')
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const { displayCount, clearTopicMessages } = useMessageOperations(topic)
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

  useEffect(() => {
    const newDisplayMessages = computeDisplayMessages(messages, 0, displayCount)
    setDisplayMessages(newDisplayMessages)
    setHasMore(messages.length > displayCount)
  }, [messages, displayCount])

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

      await clearTopicMessages()
      setDisplayMessages([])
    },
    [clearTopicMessages, topic.id]
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
      EventEmitter.on(EVENT_NAMES.NEW_BRANCH, async (index: number) => {
        const currentMessages = messagesRef.current

        if (index < 0 || index >= currentMessages.length) {
          logger.error(`[NEW_BRANCH] Invalid branch index: ${index}`)
          return
        }

        const sourceMessage = currentMessages[index]

        try {
          const created = await createTopic({
            name: topic.name,
            assistantId: assistant.id,
            sourceNodeId: sourceMessage.id
          })
          const newTopic = { ...created, messages: [] } as Topic
          setActiveTopic(newTopic)
        } catch (err) {
          logger.error('[NEW_BRANCH] Failed to create topic branch via DataApi', { topicId: topic.id, err })
          window.toast.error(t('message.branch.error'))
        }
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
    if (!hasMore || isLoadingMore) return

    setIsLoadingMore(true)
    setTimeoutTimer(
      'loadMoreMessages',
      () => {
        const currentLength = displayMessages.length
        const newMessages = computeDisplayMessages(messages, currentLength, LOAD_MORE_COUNT)

        setDisplayMessages((prev) => [...prev, ...newMessages])
        setHasMore(currentLength + LOAD_MORE_COUNT < messages.length)
        setIsLoadingMore(false)
      },
      300
    )
  }, [displayMessages.length, hasMore, isLoadingMore, messages, setTimeoutTimer])

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

const computeDisplayMessages = (messages: Message[], startIndex: number, displayCount: number) => {
  // 如果剩余消息数量小于 displayCount，直接返回所有剩余消息的倒序切片
  if (messages.length - startIndex <= displayCount) {
    const result: Message[] = []
    for (let i = messages.length - 1 - startIndex; i >= 0; i--) {
      result.push(messages[i])
    }
    return result
  }
  const userIdSet = new Set() // 用户消息 id 集合
  const assistantIdSet = new Set() // 助手消息 askId 集合
  const displayMessages: Message[] = []

  // 处理单条消息的函数
  const processMessage = (message: Message) => {
    if (!message) return

    const idSet = message.role === 'user' ? userIdSet : assistantIdSet
    const messageId = message.role === 'user' ? message.id : message.askId

    if (!idSet.has(messageId)) {
      idSet.add(messageId)
      displayMessages.push(message)
      return
    }
    // 如果是相同 askId 的助手消息，也要显示
    displayMessages.push(message)
  }

  // 直接在原数组上倒序遍历，跳过前 startIndex 个，避免全量拷贝和 reverse()
  for (let i = messages.length - 1 - startIndex; i >= 0 && userIdSet.size + assistantIdSet.size < displayCount; i--) {
    processMessage(messages[i])
  }

  return displayMessages
}

export default Messages
