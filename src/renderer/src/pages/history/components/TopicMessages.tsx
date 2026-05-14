import { MessageOutlined } from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import MessageGroup from '@renderer/components/chat/messages/list/MessageGroup'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useTimer } from '@renderer/hooks/useTimer'
import { getTopicById } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages, locateToMessage } from '@renderer/services/MessagesService'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { classNames, runAsyncFunction } from '@renderer/utils'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useNavigate } from '@tanstack/react-router'
import { Divider, Empty } from 'antd'
import { t } from 'i18next'
import { Forward } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import { HistoryMessageListProvider } from './HistoryMessageListProvider'
import { legacyMessageToListItem } from './legacyMessageListItem'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  topic?: Topic
}

const TopicMessages: FC<Props> = ({ topic: _topic, ...props }) => {
  const navigate = useNavigate()

  const { handleScroll, containerRef } = useScrollPosition('TopicMessages')
  const [messageStyle] = usePreference('chat.message.style')
  const { setTimeoutTimer } = useTimer()

  const [topic, setTopic] = useState<Topic | undefined>(_topic)

  useEffect(() => {
    setTopic(_topic ? { ..._topic, messages: [] } : undefined)
    if (!_topic) return

    void runAsyncFunction(async () => {
      const topic = await getTopicById(_topic.id)
      setTopic(topic)
    })
  }, [_topic])

  const isEmpty = (topic?.messages || []).length === 0
  const groupedMessages = useMemo(() => {
    if (!topic?.messages?.length) return []
    return Object.entries(getGroupedMessages(topic.messages)).map(
      ([key, groupMessages]) => [key, groupMessages.map(legacyMessageToListItem)] as const
    )
  }, [topic?.messages])
  const messageItems = useMemo(() => groupedMessages.flatMap(([, messages]) => messages), [groupedMessages])

  const partsMap = useMemo(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const message of topic?.messages || []) {
      const parts = message.parts ?? []
      if (parts.length > 0) map[message.id] = parts
    }
    return map
  }, [topic?.messages])

  if (!topic) {
    return null
  }

  const onContinueChat = async (topic: Topic) => {
    SearchPopup.hide()
    // Validate `topic.assistantId` against DataApi so a deleted assistant
    // doesn't leak a dangling id into the route. Falls back to undefined.
    const assistantId = topic.assistantId
      ? await dataApiService
          .get(`/assistants/${topic.assistantId}`)
          .then((a) => a?.id)
          .catch(() => undefined)
      : undefined
    void navigate({ to: '/app/chat', search: { assistantId, topicId: topic.id } })
    setTimeoutTimer('onContinueChat', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 100)
  }

  return (
    <MessageEditingProvider>
      <HistoryMessageListProvider topic={topic} messages={messageItems} partsByMessageId={partsMap}>
        <MessagesContainer {...props} ref={containerRef} onScroll={handleScroll}>
          <ContainerWrapper className={messageStyle}>
            {groupedMessages.map(([key, groupMessages]) => {
              const locateMessage = topic.messages.find((message) => message.id === groupMessages[0]?.id) as
                | Message
                | undefined
              const wrapperRole = groupMessages[0]?.role

              return (
                <MessageWrapper key={key} className={classNames([messageStyle, wrapperRole])}>
                  <MessageGroup messages={groupMessages} topic={topic} />
                  {locateMessage && (
                    <Button
                      variant="ghost"
                      className="absolute top-[5px] right-0 text-[var(--color-text-3)]"
                      onClick={() => locateToMessage(navigate, locateMessage)}>
                      <Forward size={16} />
                    </Button>
                  )}
                  <Divider style={{ margin: '8px auto 15px' }} variant="dashed" />
                </MessageWrapper>
              )
            })}
            {isEmpty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            {!isEmpty && (
              <RowFlex className="justify-center">
                <Button onClick={() => onContinueChat(topic)}>
                  <MessageOutlined />
                  {t('history.continue_chat')}
                </Button>
              </RowFlex>
            )}
          </ContainerWrapper>
        </MessagesContainer>
      </HistoryMessageListProvider>
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
