import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { Assistant, Topic } from '@renderer/types'
import { Flex } from 'antd'
import { FC, useMemo } from 'react'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'
import ContentTab from './TabBread/ContentTab'
import Tabs from './Tabs'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

const Chat: FC<Props> = (props) => {
  const { assistant } = useAssistant(props.assistant.id)
  const { showHorizontalTab, topicPosition, showAssistants, messageStyle } = useSettings()
  const { showTopics } = useShowTopics()

  const maxWidth = useMemo(() => {
    const showRightTopics = showTopics && topicPosition === 'right'
    const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
    const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
    return `calc(100vw - var(--sidebar-width) ${minusAssistantsWidth} ${minusRightTopicsWidth} - 5px)`
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="chat" className={messageStyle}>
      <Main id="chat-main" vertical flex={1} style={{ maxWidth }}>
        {showHorizontalTab && (
          <ContentTab
            activeTopicId={props.activeTopic.id}
            activeAssistantId={props.assistant.id}
            setActiveAssistant={props.setActiveAssistant}
            setActiveTopic={props.setActiveTopic}
          />
        )}
        <MessagesContainer>
          <Messages
            key={props.activeTopic.id}
            assistant={assistant}
            topic={props.activeTopic}
            setActiveTopic={props.setActiveTopic}
          />
        </MessagesContainer>
        <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} topic={props.activeTopic} />
      </Main>
      {topicPosition === 'right' && showTopics && (
        <Tabs
          activeAssistant={assistant}
          activeTopic={props.activeTopic}
          setActiveAssistant={props.setActiveAssistant}
          setActiveTopic={props.setActiveTopic}
          position="right"
        />
      )}
    </Container>
  )
}

const MessagesContainer = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
`

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
