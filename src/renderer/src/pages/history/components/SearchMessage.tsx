import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { default as MessageItem } from '@renderer/components/chat/messages/frame/MessageFrame'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { getTopicById } from '@renderer/hooks/useTopic'
import { locateToMessage } from '@renderer/services/MessagesService'
import NavigationService from '@renderer/services/NavigationService'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { runAsyncFunction } from '@renderer/utils'
import { Forward } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { HistoryMessageListProvider } from './HistoryMessageListProvider'
import { legacyMessageToListItem } from './legacyMessageListItem'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  message?: Message
}

const SearchMessage: FC<Props> = ({ message, ...props }) => {
  const navigate = NavigationService.navigate!
  const { t } = useTranslation()
  const [topic, setTopic] = useState<Topic | null>(null)

  useEffect(() => {
    void runAsyncFunction(async () => {
      if (message?.topicId) {
        const topic = await getTopicById(message.topicId)
        setTopic(topic)
      }
    })
  }, [message])

  const messageItem = useMemo(() => (message ? legacyMessageToListItem(message) : null), [message])
  const partsByMessageId = useMemo(() => (message ? { [message.id]: message.parts ?? [] } : {}), [message])

  if (!message) {
    return null
  }

  if (!topic) {
    return null
  }

  return (
    <MessageEditingProvider>
      <HistoryMessageListProvider
        topic={topic}
        messages={messageItem ? [messageItem] : []}
        partsByMessageId={partsByMessageId}>
        <MessagesContainer {...props}>
          <ContainerWrapper>
            {messageItem && <MessageItem message={messageItem} topic={topic} hideMenuBar={true} />}
            <Button
              variant="ghost"
              className="absolute top-4 right-4 text-[var(--color-text-3)]"
              onClick={() => locateToMessage(navigate, message)}>
              <Forward size={16} />
            </Button>
            <RowFlex className="mt-[10px] justify-center">
              <Button onClick={() => locateToMessage(navigate, message)}>
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

const MessagesContainer = styled.div`
  width: 100%;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  overflow-y: scroll;
`

const ContainerWrapper = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  position: relative;
`

export default SearchMessage
