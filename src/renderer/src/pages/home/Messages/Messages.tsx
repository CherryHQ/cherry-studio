import Scrollbar from '@renderer/components/Scrollbar'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
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
import { flatten, last, reverse, take } from 'lodash'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import Suggestions from '../components/Suggestions'
import MessageItem from './Message'
import Prompt from './Prompt'

interface Props {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
}

const Messages: FC<Props> = ({ assistant, topic, setActiveTopic }) => {
  const [messages, setMessages] = useState<Message[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const { updateTopic, addTopic } = useAssistant(assistant.id)
  const { showTopics, topicPosition, showAssistants } = useSettings()

  const messagesRef = useRef(messages)
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
    if (_topic && _topic.name === t('chat.default.topic.name') && messages.length >= 2) {
      const summaryText = await fetchMessagesSummary({ messages, assistant })
      if (summaryText) {
        const data = { ..._topic, name: summaryText }
        setActiveTopic(data)
        updateTopic(data)
      }
    }
  }, [assistant, messages, setActiveTopic, topic.id, updateTopic])

  const onDeleteMessage = useCallback(
    (message: Message) => {
      const _messages = messages.filter((m) => m.id !== message.id)
      setMessages(_messages)
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

  const memoizedMessages = useMemo(() => reverse([...messages]), [messages])

  return (
    <Container
      id="messages"
      style={{ maxWidth }}
      key={assistant.id}
      ref={containerRef}
      right={topicPosition === 'left'}>
      <Suggestions assistant={assistant} messages={messages} />
      {memoizedMessages.map((message, index) => (
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
      <Prompt assistant={assistant} key={assistant.prompt} />
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column-reverse;
  padding: 10px 0;
  padding-bottom: 20px;
  overflow-x: hidden;
  background-color: var(--color-background);
`

export default Messages
