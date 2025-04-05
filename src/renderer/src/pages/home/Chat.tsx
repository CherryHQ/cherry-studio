import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useActiveTopicContext } from '@renderer/context/ActiveTopicContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { Assistant } from '@renderer/types'
import { Flex } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'

interface Props {
  assistant: Assistant
}

const Chat: FC<Props> = (props) => {
  const { assistant } = useAssistant(props.assistant.id)
  const { messageStyle } = useSettings()
  const { activeTopic, setActiveTopic } = useActiveTopicContext()

  return (
    <Container id="chat" className={messageStyle}>
      <Main id="chat-main" vertical flex={1} justify="space-between">
        <Messages key={activeTopic.id} assistant={assistant} topic={activeTopic} setActiveTopic={setActiveTopic} />
        <QuickPanelProvider>
          <Inputbar assistant={assistant} setActiveTopic={setActiveTopic} topic={activeTopic} />
        </QuickPanelProvider>
      </Main>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  height: 100%;
  flex: 1;
  justify-content: space-between;
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
  // 设置为containing block，方便子元素fixed定位
  transform: translateZ(0);
`

export default Chat
