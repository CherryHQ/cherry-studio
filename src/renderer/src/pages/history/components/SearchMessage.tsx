import { Button, RowFlex, Scrollbar } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { default as MessageItem } from '@renderer/components/chat/messages/frame/MessageFrame'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { mapApiTopicToRendererTopic } from '@renderer/hooks/useTopicDataApi'
import { locateToMessage } from '@renderer/services/MessagesService'
import NavigationService from '@renderer/services/NavigationService'
import type { Topic } from '@renderer/types'
import { sharedMessageToUIMessage, uiMessagesToPartsMap } from '@renderer/utils/messageUtils/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'
import { Forward } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { HistoryMessageListProvider } from './HistoryMessageListProvider'

const logger = loggerService.withContext('HistorySearchMessage')

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  message?: {
    messageId: string
    topicId: string
  }
}

const SearchMessage: FC<Props> = ({ message, ...props }) => {
  const navigate = NavigationService.navigate!
  const { t } = useTranslation()
  const [topic, setTopic] = useState<Topic | null>(null)
  const [uiMessage, setUiMessage] = useState<CherryUIMessage | null>(null)

  useEffect(() => {
    let cancelled = false
    setTopic(null)
    setUiMessage(null)

    if (!message) return

    void Promise.all([
      dataApiService.get(`/topics/${message.topicId}`),
      dataApiService.get(`/messages/${message.messageId}`)
    ])
      .then(([apiTopic, sharedMessage]) => {
        if (cancelled) return
        setTopic(mapApiTopicToRendererTopic(apiTopic))
        setUiMessage(sharedMessageToUIMessage(sharedMessage))
      })
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to load searched message', error as Error)
      })

    return () => {
      cancelled = true
    }
  }, [message])

  const messageItem = useMemo(() => {
    if (!message || !topic || !uiMessage) return null
    return toMessageListItem(uiMessage, { topicId: message.topicId, assistantId: topic.assistantId })
  }, [message, topic, uiMessage])
  const partsByMessageId = useMemo(() => (uiMessage ? uiMessagesToPartsMap([uiMessage]) : {}), [uiMessage])

  if (!message || !topic || !messageItem) {
    return null
  }

  return (
    <MessageEditingProvider>
      <HistoryMessageListProvider topic={topic} messages={[messageItem]} partsByMessageId={partsByMessageId}>
        <MessagesContainer {...props}>
          <ContainerWrapper>
            <MessageItem message={messageItem} topic={topic} hideMenuBar={true} />
            <Button
              variant="ghost"
              className="absolute top-4 right-4 text-[var(--color-text-3)]"
              onClick={() => locateToMessage(navigate, messageItem)}>
              <Forward size={16} />
            </Button>
            <RowFlex className="mt-[10px] justify-center">
              <Button onClick={() => locateToMessage(navigate, messageItem)}>
                <Forward size={16} />
                {t('history.locate.message')}
              </Button>
            </RowFlex>
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
  display: flex;
  flex-direction: column;
  padding: 16px;
  position: relative;
`

export default SearchMessage
