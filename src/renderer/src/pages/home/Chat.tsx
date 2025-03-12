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
  // 确保assistant存在并且有id属性
  const assistantId = props.assistant?.id
  const { assistant } = useAssistant(assistantId || '')
  const { topicPosition, messageStyle } = useSettings()
  const { showTopics } = useShowTopics()

  // 如果没有有效的assistant，则不渲染任何内容
  if (!assistantId) {
    console.error('Chat组件接收到无效的assistant对象', props.assistant)
    return null
  }

  // 确保activeTopic存在
  if (!props.activeTopic) {
    console.error('Chat组件接收到无效的activeTopic对象', props.activeTopic)
    return null
  }

  return (
    <Container id="chat" className={messageStyle}>
      <Main id="chat-main" vertical flex={1} justify="space-between">
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
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
`

export default Chat
