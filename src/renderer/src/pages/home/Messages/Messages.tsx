import Scrollbar from '@renderer/components/Scrollbar'
import { LOAD_MORE_COUNT } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { getTopic } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getContextCount, getGroupedMessages, getUserMessage } from '@renderer/services/MessagesService'
import { estimateHistoryTokens } from '@renderer/services/TokenService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  clearTopicMessages,
  selectDisplayCount,
  selectLoading,
  selectTopicMessages,
  updateMessages
} from '@renderer/store/messages'
import type { Assistant, Message, Topic } from '@renderer/types'
import {
  captureScrollableDivAsBlob,
  captureScrollableDivAsDataURL,
  removeSpecialCharactersForFileName,
  runAsyncFunction
} from '@renderer/utils'
import { isEmpty, last } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import InfiniteScroll from 'react-infinite-scroll-component'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import MessageGroup from './MessageGroup'
import NarrowLayout from './NarrowLayout'
import Prompt from './Prompt'

interface MessagesProps {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
}

const Messages: React.FC<MessagesProps> = ({ assistant, topic, setActiveTopic }) => {
  const { t } = useTranslation()
  const { showTopics, topicPosition, showAssistants, enableTopicNaming } = useSettings()
  const { updateTopic } = useAssistant(assistant.id)
  const messages = useAppSelector((state) => selectTopicMessages(state, topic.id))
  const loading = useAppSelector(selectLoading)
  const displayCount = useAppSelector(selectDisplayCount)
  const dispatch = useAppDispatch()
  const containerRef = useRef<HTMLDivElement>(null)
  const [displayMessages, setDisplayMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const messagesRef = useRef<Message[]>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    const reversedMessages = [...messages].reverse()
    const newDisplayMessages = reversedMessages.slice(0, displayCount)

    setDisplayMessages(newDisplayMessages)
    setHasMore(messages.length > displayCount)
  }, [messages, displayCount])

  const handleDeleteMessage = useCallback(
    async (message: Message) => {
      const newMessages = messages.filter((m) => m.id !== message.id)
      await dispatch(updateMessages(topic, newMessages))
    },
    [dispatch, topic, messages]
  )

  const handleDeleteGroupMessages = useCallback(
    async (askId: string) => {
      const newMessages = messages.filter((m) => m.askId !== askId)
      await dispatch(updateMessages(topic, newMessages))
    },
    [dispatch, topic, messages]
  )

  const maxWidth = useMemo(() => {
    const showRightTopics = showTopics && topicPosition === 'right'
    const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
    const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
    return `calc(100vw - var(--sidebar-width) ${minusAssistantsWidth} ${minusRightTopicsWidth} - 5px)`
  }, [showAssistants, showTopics, topicPosition])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'auto' }), 50)
  }, [])

  const autoRenameTopic = useCallback(async () => {
    let messages = [...messagesRef.current]
    const _topic = getTopic(assistant, topic.id)

    if (isEmpty(messages)) {
      return
    }

    messages = messages.filter((m) => m.status === 'success')

    if (!enableTopicNaming) {
      const topicName = messages[0]?.content.substring(0, 50)
      if (topicName) {
        const data = { ..._topic, name: topicName } as Topic
        setActiveTopic(data)
        updateTopic(data)
      }
      return
    }

    if (_topic && _topic.name === t('chat.default.topic.name') && messages.length >= 2) {
      const summaryText = await fetchMessagesSummary({ messages, assistant })
      if (summaryText) {
        const data = { ..._topic, name: summaryText }
        setActiveTopic(data)
        updateTopic(data)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant, topic.id, enableTopicNaming, t, setActiveTopic])

  useEffect(() => {
    const messages = messagesRef.current

    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, () => {
        scrollToBottom()
      }),
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, async (data: Topic) => {
        const defaultTopic = getDefaultTopic(assistant.id)

        if (data && data.id !== topic.id) {
          await dispatch(clearTopicMessages(data.id))
          updateTopic({ ...data, name: defaultTopic.name } as Topic)
          return
        }

        await dispatch(clearTopicMessages(topic.id))
        setDisplayMessages([])
        const _topic = getTopic(assistant, topic.id)
        if (_topic) {
          updateTopic({ ..._topic, name: defaultTopic.name } as Topic)
        }
      }),
      EventEmitter.on(EVENT_NAMES.COPY_TOPIC_IMAGE, async () => {
        await captureScrollableDivAsBlob(containerRef, async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          }
        })
      }),
      EventEmitter.on(EVENT_NAMES.EXPORT_TOPIC_IMAGE, async () => {
        const imageData = await captureScrollableDivAsDataURL(containerRef)
        if (imageData) {
          window.api.file.saveImage(removeSpecialCharactersForFileName(topic.name), imageData)
        }
      }),
      EventEmitter.on(EVENT_NAMES.NEW_CONTEXT, async () => {
        const lastMessage = last(messages)
        if (lastMessage?.type === 'clear') {
          handleDeleteMessage(lastMessage)
          scrollToBottom()
          return
        }

        if (messages.length === 0) return

        const clearMessage = getUserMessage({ assistant, topic, type: 'clear' })
        const newMessages = [...messages, clearMessage]
        await dispatch(updateMessages(topic, newMessages))
        scrollToBottom()
      })
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [assistant, dispatch, handleDeleteMessage, scrollToBottom, topic, updateTopic])

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.AI_AUTO_RENAME, autoRenameTopic)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [autoRenameTopic])

  useEffect(() => {
    runAsyncFunction(async () => {
      EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, {
        tokensCount: await estimateHistoryTokens(assistant, messages),
        contextCount: getContextCount(assistant, messages)
      })
    })
  }, [assistant, messages])

  const loadMoreMessages = useCallback(() => {
    if (!hasMore || isLoadingMore) return

    setIsLoadingMore(true)
    setTimeout(() => {
      const currentLength = displayMessages.length
      const reversedMessages = [...messages].reverse()
      const moreMessages = reversedMessages.slice(currentLength, currentLength + LOAD_MORE_COUNT)

      setDisplayMessages((prev) => [...prev, ...moreMessages])
      setHasMore(currentLength + LOAD_MORE_COUNT < messages.length)
      setIsLoadingMore(false)
    }, 300)
  }, [displayMessages.length, hasMore, isLoadingMore, messages])

  useShortcut('copy_last_message', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      navigator.clipboard.writeText(lastMessage.content)
      window.message.success(t('message.copy.success'))
    }
  })

  return (
    <Container
      id="messages"
      style={{ maxWidth }}
      key={assistant.id}
      ref={containerRef}
      $right={topicPosition === 'left'}>
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <InfiniteScroll
          dataLength={displayMessages.length}
          next={loadMoreMessages}
          hasMore={hasMore}
          loader={null}
          inverse={true}
          scrollableTarget="messages">
          <ScrollContainer>
            <LoaderContainer $loading={loading || isLoadingMore}>
              <BeatLoader size={8} color="var(--color-text-2)" />
            </LoaderContainer>
            {Object.entries(getGroupedMessages(displayMessages)).map(([key, groupMessages]) => (
              <MessageGroup
                key={key}
                messages={groupMessages}
                topic={topic}
                hidePresetMessages={assistant.settings?.hideMessages}
                onSetMessages={setDisplayMessages}
                onDeleteMessage={handleDeleteMessage}
                onDeleteGroupMessages={handleDeleteGroupMessages}
                onGetMessages={() => messages}
              />
            ))}
          </ScrollContainer>
        </InfiniteScroll>
        <Prompt assistant={assistant} key={assistant.prompt} topic={topic} />
      </NarrowLayout>
    </Container>
  )
}

interface LoaderProps {
  $loading: boolean
}

const LoaderContainer = styled.div<LoaderProps>`
  display: flex;
  justify-content: center;
  padding: 10px;
  width: 100%;
  background: var(--color-background);
  opacity: ${(props) => (props.$loading ? 1 : 0)};
  transition: opacity 0.3s ease;
  pointer-events: none;
`

const ScrollContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
`

interface ContainerProps {
  $right?: boolean
}

const Container = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex-direction: column-reverse;
  padding: 10px 0 20px;
  overflow-x: hidden;
  background-color: var(--color-background);
`

export default Messages
