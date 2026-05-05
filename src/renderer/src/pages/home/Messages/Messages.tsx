import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { LoadingIcon } from '@renderer/components/Icons'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import SelectionBox from '@renderer/pages/home/Messages/SelectionBox'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import {
  captureScrollableAsBlob,
  captureScrollableAsDataURL,
  removeSpecialCharactersForFileName
} from '@renderer/utils'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import { last } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { resolvePartFromParts, usePartsMap } from './Blocks'
import { ChatVirtualList, type ChatVirtualListHandle } from './ChatVirtualList'
import MessageAnchorLine from './MessageAnchorLine'
import MessageGroup from './MessageGroup'
import NarrowLayout from './NarrowLayout'
import Prompt from './Prompt'
import { MessagesContainer } from './shared'

interface MessagesProps {
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
  topic,
  onComponentUpdate,
  onFirstUpdate,
  messages,
  loadOlder,
  hasOlder = false
}) => {
  const { assistant } = useAssistant(topic.assistantId)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [showPrompt] = usePreference('chat.message.show_prompt')
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const v2Chat = useV2Chat()
  const { setTimeoutTimer } = useTimer()

  const { isMultiSelectMode, handleSelectMessage } = useChatContext(topic)

  const chatListRef = useRef<ChatVirtualListHandle | null>(null)
  // Mirrors the scroll element from `chatListRef.current?.getScrollElement()`
  // so consumers expecting a ref-shaped object (capture utils, SelectionBox)
  // don't have to thread the imperative handle around. Updated after each
  // commit by the effect below.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

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

  // Chronological order (oldest first). Display order matches array order
  // now that the column-reverse trick is gone — `ChatVirtualList` owns
  // scrolling and starts at the bottom on first mount.
  const displayMessages = messages
  const hasMore = hasOlder

  const scrollToBottom = useCallback(() => {
    chatListRef.current?.scrollToBottom('instant')
  }, [])

  const scrollToMessageById = useCallback(
    (messageId: string) => {
      const target = messages.find((m) => m.id === messageId)
      if (!target) return
      const groupKey =
        target.role === 'assistant' && target.askId ? 'assistant' + target.askId : target.role + target.id
      chatListRef.current?.scrollToKey(groupKey, 'start')
    },
    [messages]
  )

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
    if (!assistant) return
    onFirstUpdate?.()
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

  // Chronological grouping. The legacy code reversed twice (outer + inner)
  // to compensate for `column-reverse`; with the natural-direction
  // virtualized list both reversals are gone.
  const groupedMessages = useMemo(() => {
    const grouped = getGroupedMessages(displayMessages)
    return Object.entries(grouped)
  }, [displayMessages])

  // After the virtualizer mounts, mirror its scroll element into the
  // ref shape that `captureScrollableAsBlob` / `SelectionBox` expect.
  useEffect(() => {
    scrollContainerRef.current = (chatListRef.current?.getScrollElement() as HTMLDivElement | null) ?? null
  }, [groupedMessages])

  return (
    <MessagesContainer id="messages" className="messages-container" key={assistant?.id ?? topic.assistantId}>
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {showPrompt && <Prompt key={assistant?.prompt ?? ''} topic={topic} />}
        <ContextMenu>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ChatVirtualList
              handleRef={chatListRef}
              items={groupedMessages}
              getItemKey={([key]) => key}
              estimateSize={600}
              overscan={8}
              hasMoreTop={hasMore}
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
                <LoadingIcon color="var(--color-text-2)" />
              </div>
            )}
          </div>
        </ContextMenu>
      </NarrowLayout>
      {messageNavigation === 'anchor' && (
        <MessageAnchorLine
          messages={displayMessages}
          scrollToMessageId={scrollToMessageById}
          scrollToBottom={scrollToBottom}
        />
      )}
      <SelectionBox
        isMultiSelectMode={isMultiSelectMode}
        scrollContainerRef={scrollContainerRef as React.RefObject<HTMLDivElement>}
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
