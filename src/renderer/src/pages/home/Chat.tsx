import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { Assistant, Topic } from '@renderer/types'
import { Flex } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'
import Tabs from './Tabs'

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

  return (
    <Container id="chat" className={messageStyle}>
      <Main vertical flex={1} justify="space-between">
        <Messages
          key={props.activeTopic.id}
          assistant={assistant}
          topic={props.activeTopic}
          setActiveTopic={props.setActiveTopic}
        />
        <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} />
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

const Container = styled.div`
  display: flex;
  flex-direction: row;
  height: 100%;
  flex: 1;
  justify-content: space-between;
  background-color: var(--color-background);
  &.bubble {
    background-color: var(--chat-background);
    #messages {
      background-color: var(--chat-background);
    }
    .system-prompt {
      background-color: var(--chat-background-assistant);
    }
    .message-content-container {
      margin: 5px 0;
      border-radius: 8px;
      padding: 10px 15px 0 15px;
    }
    .message-user {
      .markdown,
      .anticon,
      .iconfont,
      .message-tokens {
        color: var(--chat-text-user);
      }
      .message-action-button:hover {
        background-color: var(--color-white-soft);
      }
    }
    #inputbar {
      border-radius: 0;
      margin: 0;
      border: none;
      border-top: 1px solid var(--color-border-mute);
      background: var(--color-background);
    }
  }
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
`

export default Chat
