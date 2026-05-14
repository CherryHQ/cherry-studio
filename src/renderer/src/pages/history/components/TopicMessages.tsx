import { MessageOutlined } from '@ant-design/icons'
import { Button, RowFlex, Scrollbar } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import MessageGroup from '@renderer/components/chat/messages/list/MessageGroup'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { locateToMessage } from '@renderer/services/MessagesService'
import type { Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { branchMessagesToFullUIMessages, uiMessagesToPartsMap } from '@renderer/utils/messageUtils/messageProjection'
import type { BranchMessage, BranchMessagesResponse, CherryUIMessage } from '@shared/data/types/message'
import { useNavigate } from '@tanstack/react-router'
import { Divider, Empty } from 'antd'
import { t } from 'i18next'
import { Forward } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import { HistoryMessageListProvider } from './HistoryMessageListProvider'

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  topic?: Topic
}

const logger = loggerService.withContext('HistoryTopicMessages')
const HISTORY_MESSAGES_PAGE_SIZE = 200

async function loadHistoryTopicMessages(topicId: string): Promise<CherryUIMessage[]> {
  const pages: BranchMessage[][] = []
  let cursor: string | undefined

  do {
    const response = (await dataApiService.get(`/topics/${topicId}/messages`, {
      query: {
        limit: HISTORY_MESSAGES_PAGE_SIZE,
        includeSiblings: true,
        ...(cursor ? { cursor } : {})
      }
    })) as BranchMessagesResponse
    pages.push(response.items)
    cursor = response.nextCursor
  } while (cursor)

  return branchMessagesToFullUIMessages(pages.reverse().flat())
}

function groupMessageListItems(messages: MessageListItem[]): Record<string, MessageListItem[]> {
  const grouped: Record<string, MessageListItem[]> = {}

  for (const message of messages) {
    const key =
      message.role === 'assistant' && message.parentId ? `assistant${message.parentId}` : message.role + message.id
    grouped[key] ??= []
    grouped[key].push(message)
  }

  return grouped
}

const TopicMessages: FC<Props> = ({ topic: _topic, ...props }) => {
  const navigate = useNavigate()

  const { handleScroll, containerRef } = useScrollPosition('TopicMessages')
  const [messageStyle] = usePreference('chat.message.style')
  const { setTimeoutTimer } = useTimer()

  const topic = _topic
  const topicId = topic?.id ?? ''
  const [uiMessages, setUiMessages] = useState<CherryUIMessage[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)

  useEffect(() => {
    let cancelled = false
    setUiMessages([])
    setIsLoadingMessages(!!topicId)

    if (!topicId) return

    void loadHistoryTopicMessages(topicId)
      .then((messages) => {
        if (!cancelled) setUiMessages(messages)
      })
      .catch((error) => {
        if (!cancelled) logger.error('Failed to load history topic messages', error as Error)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMessages(false)
      })

    return () => {
      cancelled = true
    }
  }, [topicId])

  const messageItems = useMemo(() => {
    if (!topic || !topicId) return []
    return uiMessages.map((message) => toMessageListItem(message, { topicId, assistantId: topic.assistantId }))
  }, [topic, topicId, uiMessages])
  const groupedMessages = useMemo(() => Object.entries(groupMessageListItems(messageItems)), [messageItems])
  const partsMap = useMemo(() => uiMessagesToPartsMap(uiMessages), [uiMessages])
  const hasMessages = messageItems.length > 0
  const isEmpty = !isLoadingMessages && !hasMessages

  if (!topic) {
    return null
  }

  const onContinueChat = async (topic: Topic) => {
    SearchPopup.hide()
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
              const locateMessage = groupMessages[0]
              const wrapperRole = locateMessage?.role

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
            {hasMessages && (
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

const MessagesContainer = styled(Scrollbar)`
  width: 100%;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
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
