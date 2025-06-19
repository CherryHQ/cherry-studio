import Scrollbar from '@renderer/components/Scrollbar'
import { Assistant, Topic } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

import Messages from './components/Messages'
interface Props {
  route: string
  assistant: Assistant | null
  topic: Topic | null
  isOutputted: boolean
}

const ChatWindow: FC<Props> = ({ route, assistant, topic, isOutputted }) => {
  if (!assistant || !topic) return null

  return (
    <Main className="bubble">
      <Messages assistant={assistant} topic={topic} route={route} isOutputted={isOutputted} />
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
