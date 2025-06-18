import { ArrowRightOutlined, MessageOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { useChat } from '@renderer/hooks/useChat'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import { getAssistantById } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { locateToMessage } from '@renderer/services/MessagesService'
import { useAppDispatch } from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { Topic } from '@renderer/types'
import { Button, Divider, Empty } from 'antd'
import { t } from 'i18next'
import { FC, useEffect } from 'react'
import styled from 'styled-components'

import { default as MessageItem } from '../../home/Messages/Message'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  topic?: Topic
}

const TopicMessages: FC<Props> = ({ topic, ...props }) => {
  const { handleScroll, containerRef } = useScrollPosition('TopicMessages')
  const { messageStyle } = useSettings()
  const dispatch = useAppDispatch()
  const { setActiveAssistant, setActiveTopic } = useChat()

  useEffect(() => {
    topic && dispatch(loadTopicMessagesThunk(topic.id))
  }, [dispatch, topic])

  const isEmpty = (topic?.messages || []).length === 0

  if (!topic) {
    return null
  }

  const onContinueChat = async (topic: Topic) => {
    SearchPopup.hide()
    const assistant = getAssistantById(topic.assistantId)
    if (assistant) {
      setActiveAssistant(assistant)
      setActiveTopic(topic)
      setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 100)
    }
  }

  return (
    <MessageEditingProvider>
      <MessagesContainer {...props} ref={containerRef} onScroll={handleScroll} className={messageStyle}>
        <ContainerWrapper style={{ paddingTop: 30, paddingBottom: 30 }}>
          {topic?.messages.map((message) => (
            <div key={message.id} style={{ position: 'relative' }}>
              <MessageItem message={message} topic={topic} hideMenuBar={true} />
              <Button
                type="text"
                size="middle"
                style={{ color: 'var(--color-text-3)', position: 'absolute', right: 0, top: 5 }}
                onClick={() => locateToMessage(message)}
                icon={<ArrowRightOutlined />}
              />
              <Divider style={{ margin: '8px auto 15px' }} variant="dashed" />
            </div>
          ))}
          {isEmpty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {!isEmpty && (
            <HStack justifyContent="center">
              <Button onClick={() => onContinueChat(topic)} icon={<MessageOutlined />}>
                {t('history.continue_chat')}
              </Button>
            </HStack>
          )}
        </ContainerWrapper>
      </MessagesContainer>
    </MessageEditingProvider>
  )
}

const MessagesContainer = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: scroll;
`

const ContainerWrapper = styled.div`
  width: 100%;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  .message {
    padding: 0;
  }
`

export default TopicMessages
