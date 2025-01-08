import Scrollbar from '@renderer/components/Scrollbar'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { getTopic, TopicManager } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import {
  deleteMessageFiles,
  filterMessages,
  getAssistantMessage,
  getContextCount,
  getUserMessage
} from '@renderer/services/MessagesService'
import { estimateHistoryTokens } from '@renderer/services/TokenService'
import { Assistant, Message, Model, Topic } from '@renderer/types'
import { captureScrollableDiv, runAsyncFunction, uuid } from '@renderer/utils'
import { t } from 'i18next'
import { flatten, last, take } from 'lodash'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import InfiniteScroll from 'react-infinite-scroll-component'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import Suggestions from '../components/Suggestions'
import MessageItem from './Message'
import NarrowLayout from './NarrowLayout'
import Prompt from './Prompt'

interface Props {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
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
  right?: boolean
}

const Container = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex-direction: column-reverse;
  padding: 10px 0;
  padding-bottom: 20px;
  overflow-x: hidden;
  background-color: var(--color-background);
`

const Messages: FC<Props> = ({ assistant, topic, setActiveTopic }) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [displayMessages, setDisplayMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  const { updateTopic, addTopic } = useAssistant(assistant.id)
  const { showTopics, topicPosition, showAssistants, enableTopicNaming } = useSettings()

  const INITIAL_MESSAGES_COUNT = 20
  const LOAD_MORE_COUNT = 20

  messagesRef.current = messages

  const maxWidth = useMemo(() => {
    const showRightTopics = showTopics && topicPosition === 'right'
    const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
    const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
    return `calc(100vw - var(--sidebar-width) ${minusAssistantsWidth} ${minusRightTopicsWidth} - 5px)`
  }, [showAssistants, showTopics, topicPosition])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'auto' }), 50)
  }, [])

  const onSendMessage = useCallback(
    async (message: Message) => {
      const assistantMessage = getAssistantMessage({ assistant, topic })

      setMessages((prev) => {
        const messages = prev.concat([message, assistantMessage])
        db.topics.put({ id: topic.id, messages })
        return messages
      })

      scrollToBottom()
    },
    [assistant, scrollToBottom, topic]
  )

  const autoRenameTopic = useCallback(async () => {
    const _topic = getTopic(assistant, topic.id)

    // If the topic auto naming is not enabled, use the first message content as the topic name
    if (!enableTopicNaming) {
      const topicName = messages[0].content.substring(0, 50)
      const data = { ..._topic, name: topicName } as Topic
      setActiveTopic(data)
      updateTopic(data)
      return
    }

    // Auto rename the topic
    if (_topic && _topic.name === t('chat.default.topic.name') && messages.length >= 2) {
      const summaryText = await fetchMessagesSummary({ messages, assistant })
      if (summaryText) {
        const data = { ..._topic, name: summaryText }
        setActiveTopic(data)
        updateTopic(data)
      }
    }
  }, [assistant, enableTopicNaming, messages, setActiveTopic, topic.id, updateTopic])

  const onDeleteMessage = useCallback(
    (message: Message) => {
      const _messages = messages.filter((m) => m.id !== message.id)
      setMessages(_messages)
      setDisplayMessages(_messages)
      db.topics.update(topic.id, { messages: _messages })
      deleteMessageFiles(message)
    },
    [messages, topic.id]
  )

  const onGetMessages = useCallback(() => {
    return messagesRef.current
  }, [])

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, onSendMessage),
      EventEmitter.on(EVENT_NAMES.RECEIVE_MESSAGE, async () => {
        setTimeout(() => EventEmitter.emit(EVENT_NAMES.AI_AUTO_RENAME), 100)
      }),
      EventEmitter.on(EVENT_NAMES.REGENERATE_MESSAGE, async (model: Model) => {
        const lastUserMessage = last(filterMessages(messages).filter((m) => m.role === 'user'))
        lastUserMessage && onSendMessage({ ...lastUserMessage, id: uuid(), type: '@', modelId: model.id })
      }),
      EventEmitter.on(EVENT_NAMES.AI_AUTO_RENAME, autoRenameTopic),
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, () => {
        setMessages([])
        setDisplayMessages([])
        const defaultTopic = getDefaultTopic(assistant.id)
        updateTopic({ ...topic, name: defaultTopic.name, messages: [] })
        TopicManager.clearTopicMessages(topic.id)
      }),
      EventEmitter.on(EVENT_NAMES.EXPORT_TOPIC_IMAGE, async () => {
        const imageData = await captureScrollableDiv(containerRef)
        if (imageData) {
          window.api.file.saveImage(topic.name, imageData)
        }
      }),
      EventEmitter.on(EVENT_NAMES.NEW_CONTEXT, () => {
        const lastMessage = last(messages)

        if (lastMessage && lastMessage.type === 'clear') {
          onDeleteMessage(lastMessage)
          scrollToBottom()
          return
        }

        if (messages.length === 0) {
          return
        }

        setMessages((prev) => {
          const messages = prev.concat([getUserMessage({ assistant, topic, type: 'clear' })])
          db.topics.put({ id: topic.id, messages })
          return messages
        })

        scrollToBottom()
      }),
      EventEmitter.on(EVENT_NAMES.NEW_BRANCH, async (index: number) => {
        const newTopic = getDefaultTopic(assistant.id)
        newTopic.name = topic.name
        const branchMessages = take(messages, messages.length - index)

        // 将分支的消息放入数据库
        await db.topics.add({ id: newTopic.id, messages: branchMessages })
        addTopic(newTopic)
        setActiveTopic(newTopic)
        autoRenameTopic()

        // 由于复制了消���，消息中附带的文件的总数变了，需要更新
        const filesArr = branchMessages.map((m) => m.files)
        const files = flatten(filesArr).filter(Boolean)
        files.map(async (f) => {
          const file = await db.files.get({ id: f?.id })
          file && db.files.update(file.id, { count: file.count + 1 })
        })
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [
    addTopic,
    assistant,
    autoRenameTopic,
    messages,
    onDeleteMessage,
    onSendMessage,
    scrollToBottom,
    setActiveTopic,
    topic,
    updateTopic
  ])

  useEffect(() => {
    runAsyncFunction(async () => {
      const messages = (await TopicManager.getTopicMessages(topic.id)) || []
      setMessages(messages)
    })
  }, [topic.id])

  useEffect(() => {
    runAsyncFunction(async () => {
      EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, {
        tokensCount: await estimateHistoryTokens(assistant, messages),
        contextCount: getContextCount(assistant, messages)
      })
    })
  }, [assistant, messages])

  // 初始化显示最新的消息
  useEffect(() => {
    if (messages.length > 0) {
      const reversedMessages = [...messages].reverse()
      setDisplayMessages(reversedMessages.slice(0, INITIAL_MESSAGES_COUNT))
      setHasMore(messages.length > INITIAL_MESSAGES_COUNT)
    }
  }, [messages])

  // 加载更多历史消息
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
  }, [displayMessages, hasMore, isLoadingMore, messages])

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
      right={topicPosition === 'left'}>
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <Suggestions assistant={assistant} messages={messages} />
        <InfiniteScroll
          dataLength={displayMessages.length}
          next={loadMoreMessages}
          hasMore={hasMore}
          loader={null}
          inverse={true}
          scrollableTarget="messages">
          <ScrollContainer>
            <LoaderContainer $loading={isLoadingMore}>
              <BeatLoader size={8} color="var(--color-text-2)" />
            </LoaderContainer>
            {displayMessages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                topic={topic}
                index={index}
                hidePresetMessages={assistant.settings?.hideMessages}
                onSetMessages={setMessages}
                onDeleteMessage={onDeleteMessage}
                onGetMessages={onGetMessages}
              />
            ))}
          </ScrollContainer>
        </InfiniteScroll>
        <Prompt assistant={assistant} key={assistant.prompt} />
      </NarrowLayout>
    </Container>
  )
}

export default Messages
