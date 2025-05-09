import Scrollbar from '@renderer/components/Scrollbar'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { Assistant } from '@renderer/types'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { last } from 'lodash'
import { FC, useRef } from 'react'
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
  // const [messages, setMessages] = useState<Message[]>([])
  const messages = useTopicMessages(assistant.topics[0].id)
  const containerRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)

  const { t } = useTranslation()

  messagesRef.current = messages

  // const onSendMessage = useCallback(
  //   async (message: Message) => {
  //     setMessages((prev) => {
  // const assistantMessage = getAssistantMessage({ assistant, topic: assistant.topics[0] })
  // store.dispatch(newMessagesActions.addMessage({ topicId: assistant.topics[0].id, message: assistantMessage }))
  //       const messages = prev.concat([message, assistantMessage])
  //       return messages
  //     })
  //   },
  //   [assistant]
  // )

  // useEffect(() => {
  //   const unsubscribes = [EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, onSendMessage)]
  //   return () => unsubscribes.forEach((unsub) => unsub())
  // }, [assistant.id])

  useHotkeys('c', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      const content = getMainTextContent(lastMessage)
      navigator.clipboard.writeText(content)
      window.message.success(t('message.copy.success'))
    }
  })
  return (
    <Container id="messages" key={assistant.id} ref={containerRef}>
      {[...messages].reverse().map((message, index) => (
        <MessageItem key={message.id} message={message} index={index} total={messages.length} route={route} />
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
