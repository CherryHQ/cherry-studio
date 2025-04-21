import Scrollbar from '@renderer/components/Scrollbar'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getAssistantMessage } from '@renderer/services/MessagesService'
import { Assistant, Message } from '@renderer/types'
import { last } from 'lodash'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageItem from './Message'

interface Props {
  assistant: Assistant
  route: string
}

interface ContainerProps {
  right?: boolean
}

const Messages: FC<Props> = ({ assistant, route }) => {
  const [messages, setMessages] = useState<Message[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)

  const { t } = useTranslation()

  messagesRef.current = messages

  const onSendMessage = useCallback(
    async (message: Message) => {
      setMessages((prev) => {
        const assistantMessage = getAssistantMessage({ assistant, topic: assistant.topics[0] })
        const messages = prev.concat([message, assistantMessage])
        return messages
      })
    },
    [assistant]
  )

  const onGetMessages = useCallback(() => {
    return messagesRef.current
  }, [])

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, onSendMessage)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [assistant.id, onSendMessage])

  useHotkeys('c', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      navigator.clipboard.writeText(lastMessage.content)
      window.message.success(t('message.copy.success'))
    }
  })

  return (
    <Container id="messages" key={assistant.id} ref={containerRef}>
      {[...messages].reverse().map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          index={index}
          total={messages.length}
          onSetMessages={setMessages}
          onGetMessages={onGetMessages}
          route={route}
        />
      ))}
    </Container>
  )
}

const Container = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  padding-bottom: 20px;
  overflow-x: hidden;
  min-width: 100%;
  background-color: transparent !important;
`

export default Messages
