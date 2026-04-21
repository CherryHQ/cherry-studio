import Scrollbar from '@renderer/components/Scrollbar'
import type { Assistant } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'
import styled from 'styled-components'

import Messages from './components/Messages'
interface Props {
  route: string
  assistant: Assistant | null
  isOutputted: boolean
  messages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
}

const ChatWindow: FC<Props> = ({ route, assistant, isOutputted, messages, partsMap }) => {
  if (!assistant) return null

  return (
    <Main className="bubble">
      <Messages assistant={assistant} route={route} isOutputted={isOutputted} messages={messages} partsMap={partsMap} />
    </Main>
  )
}

const Main = styled(Scrollbar)`
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  margin-bottom: auto;
  -webkit-app-region: none;
  background-color: transparent !important;
  max-height: 100%;
`

export default ChatWindow
