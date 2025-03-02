import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { Assistant, Topic } from '@renderer/types'
import { Allotment } from 'allotment'
import { Flex } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'
import Tabs from './Tabs'
import { useSidebarResize } from './useSidebarResize'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

const Chat: FC<Props> = (props) => {
  const { assistant } = useAssistant(props.assistant.id)
  const { topicPosition, messageStyle } = useSettings()
  const { showTopics } = useShowTopics()
  const { sizes, handleSidebarResize } = useSidebarResize()

  return (
    <Container id="chat" className={messageStyle}>
      <Allotment onChange={handleSidebarResize}>
        <Allotment.Pane minSize={406}>
          <Main id="chat-main" vertical flex={1} justify="space-between">
            <Messages
              key={props.activeTopic.id}
              assistant={assistant}
              topic={props.activeTopic}
              setActiveTopic={props.setActiveTopic}
            />
            <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} />
          </Main>
        </Allotment.Pane>
        {topicPosition === 'right' && showTopics && (
          <Allotment.Pane preferredSize={275} minSize={180}>
            <Tabs
              activeAssistant={assistant}
              activeTopic={props.activeTopic}
              setActiveAssistant={props.setActiveAssistant}
              setActiveTopic={props.setActiveTopic}
              position="right"
              sizes={sizes}
            />
          </Allotment.Pane>
        )}
      </Allotment>
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
`

export default Chat
