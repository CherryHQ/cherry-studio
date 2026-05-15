import { LoadingOutlined } from '@ant-design/icons'
import { MessageContentProvider } from '@renderer/components/chat/messages'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/adapters/useMessageListRenderConfig'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import Scrollbar from '@renderer/components/Scrollbar'
import type { Assistant } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'
import styled from 'styled-components'

import MessageItem from './Message'

interface Props {
  assistant: Assistant
  route: string
  isOutputted: boolean
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

interface ContainerProps {
  right?: boolean
}

const Messages: FC<Props> = ({ assistant, route, isOutputted, messages, partsByMessageId }) => {
  const { renderConfig } = useMessageListRenderConfig()

  return (
    <MessageContentProvider messages={messages} partsByMessageId={partsByMessageId} renderConfig={renderConfig}>
      <Container id="messages" key={assistant.id}>
        {!isOutputted && <LoadingOutlined style={{ fontSize: 16 }} spin />}
        {[...messages].reverse().map((message, index) => (
          <MessageItem key={message.id} message={message} index={index} total={messages.length} route={route} />
        ))}
      </Container>
    </MessageContentProvider>
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
