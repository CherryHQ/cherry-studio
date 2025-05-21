import { ArrowRightOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { useSettings } from '@renderer/hooks/useSettings'
import { getTopicById } from '@renderer/hooks/useTopic'
import { ChatProvider } from '@renderer/pages/home/Messages/ChatContext'
import { default as MessageItem } from '@renderer/pages/home/Messages/Message'
import { locateToMessage } from '@renderer/services/MessagesService'
import NavigationService from '@renderer/services/NavigationService'
import { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { runAsyncFunction } from '@renderer/utils'
import { Button } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  message?: Message
}

const SearchMessage: FC<Props> = ({ message, ...props }) => {
  const navigate = NavigationService.navigate!
  const { messageStyle } = useSettings()
  const { t } = useTranslation()
  const [topic, setTopic] = useState<Topic | null>(null)

  useEffect(() => {
    runAsyncFunction(async () => {
      if (message?.topicId) {
        const topic = await getTopicById(message.topicId)
        setTopic(topic)
      }
    })
  }, [message])

  if (!message) {
    return null
  }

  if (!topic) {
    return null
  }

  return (
    <ChatProvider activeTopic={topic}>
      <MessageEditingProvider>
        <MessagesContainer {...props} className={messageStyle}>
          <ContainerWrapper style={{ paddingTop: 20, paddingBottom: 20, position: 'relative' }}>
            <MessageItem message={message} topic={topic} hideMenuBar={true} />
            <Button
              type="text"
              size="middle"
              style={{ color: 'var(--color-text-3)', position: 'absolute', right: 0, top: 10 }}
              onClick={() => locateToMessage(navigate, message)}
              icon={<ArrowRightOutlined />}
            />
            <HStack mt="10px" justifyContent="center">
              <Button onClick={() => locateToMessage(navigate, message)} icon={<ArrowRightOutlined />}>
                {t('history.locate.message')}
              </Button>
            </HStack>
          </ContainerWrapper>
        </MessagesContainer>
      </MessageEditingProvider>
    </ChatProvider>
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
  width: 800px;
  display: flex;
  flex-direction: column;
  .message {
    padding: 0;
  }
`

export default SearchMessage
