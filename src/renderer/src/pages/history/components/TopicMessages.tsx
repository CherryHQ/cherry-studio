import { MessageOutlined } from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { modelGenerating } from '@renderer/hooks/useModel'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useTimer } from '@renderer/hooks/useTimer'
import { getTopicById } from '@renderer/hooks/useTopic'
import { getAssistantById } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { locateToMessage } from '@renderer/services/MessagesService'
import NavigationService from '@renderer/services/NavigationService'
import type { Topic } from '@renderer/types'
import { classNames, runAsyncFunction } from '@renderer/utils'
import { Divider, Empty } from 'antd'
import { t } from 'i18next'
import { Forward } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { default as MessageItem } from '../../home/Messages/Message'
interface Props extends React.HTMLAttributes<HTMLDivElement> {
  topic?: Topic
}

const TopicMessages: FC<Props> = ({ topic: _topic, ...props }) => {
  const navigate = NavigationService.navigate!
  const { handleScroll, containerRef } = useScrollPosition('TopicMessages')
  const [messageStyle] = usePreference('chat.message.style')
  const { setTimeoutTimer } = useTimer()

  const [topic, setTopic] = useState<Topic | undefined>(_topic)

  useEffect(() => {
    if (!_topic) return

    runAsyncFunction(async () => {
      const topic = await getTopicById(_topic.id)
      setTopic(topic)
    })
  }, [_topic, topic])

  const isEmpty = (topic?.messages || []).length === 0

  if (!topic) {
    return null
  }

  const onContinueChat = async (topic: Topic) => {
    await modelGenerating()
    SearchPopup.hide()
    const assistant = getAssistantById(topic.assistantId)
    navigate('/', { state: { assistant, topic } })
    setTimeoutTimer('onContinueChat', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 100)
  }

  return (
    <MessageEditingProvider>
      <MessagesContainer {...props} ref={containerRef} onScroll={handleScroll}>
        <ContainerWrapper className={messageStyle}>
          {topic?.messages.map((message) => (
            <MessageWrapper key={message.id} className={classNames([messageStyle, message.role])}>
              <MessageItem message={message} topic={topic} hideMenuBar={true} />
              <Button
                variant="light"
                size="md"
                className="absolute top-[5px] right-0 text-[var(--color-text-3)]"
                onPress={() => locateToMessage(navigate, message)}
                startContent={<Forward size={16} />}
              />
              <Divider style={{ margin: '8px auto 15px' }} variant="dashed" />
            </MessageWrapper>
          ))}
          {isEmpty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {!isEmpty && (
            <RowFlex className="justify-center">
              <Button onPress={() => onContinueChat(topic)} startContent={<MessageOutlined />}>
                {t('history.continue_chat')}
              </Button>
            </RowFlex>
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
  padding: 16px;
  display: flex;
  flex-direction: column;
`

const MessageWrapper = styled.div`
  position: relative;
  &.bubble.user {
    padding-top: 26px;
  }
`

export default TopicMessages
