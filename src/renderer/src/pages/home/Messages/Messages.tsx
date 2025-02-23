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
  getAssistantMessage,
  getContextCount,
  getGroupedMessages,
  getUserMessage
} from '@renderer/services/MessagesService'
import { estimateHistoryTokens } from '@renderer/services/TokenService'
import { Assistant, Message, Topic } from '@renderer/types'
import { captureScrollableDivAsBlob, captureScrollableDivAsDataURL, runAsyncFunction } from '@renderer/utils'
import { t } from 'i18next'
import { flatten, last, take } from 'lodash'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import InfiniteScroll from 'react-infinite-scroll-component'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import Suggestions from '../components/Suggestions'
import MessageGroup from './MessageGroup'
import NarrowLayout from './NarrowLayout'
import Prompt from './Prompt'

interface Props {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
}

const Messages: FC<Props> = ({ assistant, topic, setActiveTopic }) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [displayMessages, setDisplayMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  const { updateTopic, addTopic } = useAssistant(assistant.id)
  const { showTopics, topicPosition, showAssistants, enableTopicNaming } = useSettings()

  const groupedMessages = getGroupedMessages(displayMessages)

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
      const assistantMessages: Message[] = []

      if (message.mentions?.length) {
        message.mentions.forEach((m) => {
          const assistantMessage = getAssistantMessage({ assistant: { ...assistant, model: m }, topic })
          assistantMessage.model = m
          assistantMessage.askId = message.id
          assistantMessages.push(assistantMessage)
        })
      } else {
        const assistantMessage = getAssistantMessage({ assistant, topic })
        assistantMessage.askId = message.id
        assistantMessages.push(assistantMessage)
      }

      setMessages((prev) => {
        const messages = prev.concat([message, ...assistantMessages])
        db.topics.put({ id: topic.id, messages })
        return messages
      })

      scrollToBottom()
    },
    [assistant, scrollToBottom, topic]
  )

  const onAppendMessage = useCallback(
    (message: Message) => {
      setMessages((prev) => {
        const messages = prev.concat([message])
        db.topics.put({ id: topic.id, messages })
        return messages
      })
    },
    [topic.id]
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
    async (message: Message) => {
      const _messages = messages.filter((m) => m.id !== message.id)
      setMessages(_messages)
      setDisplayMessages(_messages)
      await db.topics.update(topic.id, { messages: _messages })
      await deleteMessageFiles(message)
    },
    [messages, topic.id]
  )

  const onDeleteGroupMessages = useCallback(
    async (askId: string) => {
      const _messages = messages.filter((m) => m.askId !== askId && m.id !== askId)
      setMessages(_messages)
      setDisplayMessages(_messages)
      await db.topics.update(topic.id, { messages: _messages })
      for (const message of _messages) {
        await deleteMessageFiles(message)
      }
    },
    [messages, topic.id]
  )

  const onGetMessages = useCallback(() => {
    return messagesRef.current
  }, [])

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, onSendMessage),
      EventEmitter.on(EVENT_NAMES.APPEND_MESSAGE, onAppendMessage),
      EventEmitter.on(EVENT_NAMES.RECEIVE_MESSAGE, async () => {
        setTimeout(() => EventEmitter.emit(EVENT_NAMES.AI_AUTO_RENAME), 100)
      }),
      EventEmitter.on(EVENT_NAMES.AI_AUTO_RENAME, autoRenameTopic),
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, (data: Topic) => {
        const defaultTopic = getDefaultTopic(assistant.id)

        // Clear messages of other topics
        if (data && data.id !== topic.id) {
          TopicManager.clearTopicMessages(data.id)
          updateTopic({ ...data, name: defaultTopic.name, messages: [] })
          return
        }

        // Clear messages of current topic
        setMessages([])
        setDisplayMessages([])
        const _topic = getTopic(assistant, topic.id)
        _topic && updateTopic({ ..._topic, name: defaultTopic.name, messages: [] })
        TopicManager.clearTopicMessages(topic.id)
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

        // 由于复制了消息，消息中附带的文件的总数变了，需要更新
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
    onAppendMessage,
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
      $right={topicPosition === 'left'}>
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
            {Object.entries(groupedMessages).map(([key, messages]) => (
              <MessageGroup
                key={key}
                messages={messages}
                topic={topic}
                hidePresetMessages={assistant.settings?.hideMessages}
                onSetMessages={setMessages}
                onDeleteMessage={onDeleteMessage}
                onDeleteGroupMessages={onDeleteGroupMessages}
                onGetMessages={onGetMessages}
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
