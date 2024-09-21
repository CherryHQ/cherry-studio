import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { getTopic, TopicManager } from '@renderer/hooks/useTopic'
import { fetchChatCompletion, fetchMessagesSummary } from '@renderer/services/api'
import { getDefaultTopic } from '@renderer/services/assistant'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/event'
import { deleteMessageFiles, filterMessages, getContextCount } from '@renderer/services/messages'
import { estimateHistoryTokens, estimateMessageUsage } from '@renderer/services/tokens'
import { Assistant, Message, Model, Topic } from '@renderer/types'
import { getBriefInfo, runAsyncFunction, uuid } from '@renderer/utils'
import { t } from 'i18next'
import { flatten, last, reverse, take } from 'lodash'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
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
  const [lastMessage, setLastMessage] = useState<Message | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { updateTopic, addTopic } = useAssistant(assistant.id)

  const onSendMessage = useCallback(
    async (message: Message) => {
      if (message.role === 'user') {
        estimateMessageUsage(message).then((usage) => {
          setMessages((prev) => {
            const _messages = prev.map((m) => (m.id === message.id ? { ...m, usage } : m))
            db.topics.update(topic.id, { messages: _messages })
            return _messages
          })
        })
      }
      const _messages = [...messages, message]
      setMessages(_messages)
      db.topics.put({ id: topic.id, messages: _messages })
    },
    [messages, topic.id]
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

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, async (msg: Message) => {
        await onSendMessage(msg)
        fetchChatCompletion({
          assistant,
          messages: [...messages, msg],
          topic,
          onResponse: setLastMessage
        })
      }),
      EventEmitter.on(EVENT_NAMES.RECEIVE_MESSAGE, async (msg: Message) => {
        setLastMessage(null)
        onSendMessage(msg)
        setTimeout(() => EventEmitter.emit(EVENT_NAMES.AI_AUTO_RENAME), 100)
      }),
      EventEmitter.on(EVENT_NAMES.REGENERATE_MESSAGE, async (model: Model) => {
        const lastUserMessage = last(filterMessages(messages).filter((m) => m.role === 'user'))
        if (lastUserMessage) {
          const content = `[@${model.name}](#)  ${getBriefInfo(lastUserMessage.content)}`
          onSendMessage({ ...lastUserMessage, id: uuid(), type: '@', content })
          fetchChatCompletion({
            assistant,
            topic,
            messages: [...messages, lastUserMessage],
            onResponse: setLastMessage
          })
        }
      }),
      EventEmitter.on(EVENT_NAMES.AI_AUTO_RENAME, autoRenameTopic),
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, () => {
        setMessages([])
        updateTopic({ ...topic, messages: [] })
        TopicManager.clearTopicMessages(topic.id)
      }),
      EventEmitter.on(EVENT_NAMES.NEW_CONTEXT, () => {
        const lastMessage = last(messages)

        if (lastMessage && lastMessage.type === 'clear') {
          onDeleteMessage(lastMessage)
          return
        }

        if (messages.length === 0) {
          return
        }

        onSendMessage({
          id: uuid(),
          assistantId: assistant.id,
          role: 'user',
          content: '',
          topicId: topic.id,
          createdAt: new Date().toISOString(),
          status: 'success',
          type: 'clear'
        } as Message)
      }),
      EventEmitter.on(EVENT_NAMES.NEW_BRANCH, async (index: number) => {
        const newTopic = getDefaultTopic()
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
    setTimeout(() => containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'auto' }), 0)
  }, [messages])

  useEffect(() => {
    runAsyncFunction(async () => {
      EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, {
        tokensCount: await estimateHistoryTokens(assistant, messages),
        contextCount: getContextCount(assistant, messages)
      })
    })
  }, [assistant, messages])

  return (
    <Container id="messages" key={assistant.id} ref={containerRef}>
      <Suggestions assistant={assistant} messages={messages} lastMessage={lastMessage} />
      {lastMessage && <MessageItem key={lastMessage.id} message={lastMessage} />}
      {reverse([...messages]).map((message, index) => (
        <MessageItem key={message.id} message={message} index={index} onDeleteMessage={onDeleteMessage} />
      ))}
      <Prompt assistant={assistant} key={assistant.prompt} />
    </Container>
  )
}

const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex-direction: column-reverse;
  max-height: calc(100vh - var(--input-bar-height) - var(--navbar-height));
  padding: 10px 0;
`

export default Messages
