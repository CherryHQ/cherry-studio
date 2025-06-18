import { LoadingOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { Assistant, Topic } from '@renderer/types'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { last } from 'lodash'
import { FC } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageItem from './Message'

interface Props {
  assistant: Assistant
  topic: Topic
  route: string
  isOutputted: boolean
}

interface ContainerProps {
  right?: boolean
}

const Messages: FC<Props> = ({ assistant, topic, route, isOutputted }) => {
  const messages = useTopicMessages(topic.id)
  const { t } = useTranslation()

  useHotkeys('c', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      const content = getMainTextContent(lastMessage)
      navigator.clipboard.writeText(content)
      window.message.success(t('message.copy.success'))
    }
  })
  return (
    <Container id="messages" key={assistant.id}>
      {!isOutputted && <LoadingOutlined style={{ fontSize: 16 }} spin />}
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
