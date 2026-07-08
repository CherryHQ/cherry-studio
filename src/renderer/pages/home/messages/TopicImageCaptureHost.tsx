import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { MessageEditingProvider } from '@renderer/components/chat/editing/MessageEditingContext'
import { useMessageImageCaptureMessages } from '@renderer/components/chat/messages/hooks/useMessageImageCaptureMessages'
import MessageImageCaptureHost from '@renderer/components/chat/messages/MessageImageCaptureHost'
import { projectBranchMessagesToUI } from '@renderer/hooks/useTopicMessages'
import type { Topic } from '@renderer/types/topic'
import type { BranchMessagesResponse, CherryUIMessage } from '@shared/data/types/message'
import { memo, useCallback } from 'react'

import { useHomeMessageListProviderValue } from './homeMessageListAdapter'
import { rejectPendingTopicImageActions } from './topicImageActionBus'

const logger = loggerService.withContext('TopicImageCaptureHost')
const TOPIC_CAPTURE_MESSAGES_PAGE_SIZE = 200
const passThroughUIMessage = (message: CherryUIMessage) => message

interface TopicImageCaptureHostProps {
  topic: Topic
}

export async function getTopicImageCaptureMessages(topicId: string): Promise<CherryUIMessage[]> {
  const pages: BranchMessagesResponse['items'][] = []
  let cursor: string | undefined

  do {
    const response = (await dataApiService.get(`/topics/${topicId}/messages`, {
      query: { limit: TOPIC_CAPTURE_MESSAGES_PAGE_SIZE, includeSiblings: true, cursor }
    })) as BranchMessagesResponse

    pages.push(response.items)
    cursor = response.nextCursor
  } while (cursor)

  return projectBranchMessagesToUI(pages.reverse().flat())
}

const TopicImageCaptureHostContent = ({ topic }: TopicImageCaptureHostProps) => {
  const loadMessages = useCallback(() => getTopicImageCaptureMessages(topic.id), [topic.id])
  const handleLoadError = useCallback(
    (error: unknown) => {
      logger.error('Failed to load topic messages for image capture', error as Error, {
        topicId: topic.id
      })
      rejectPendingTopicImageActions(topic.id, error)
    },
    [topic.id]
  )
  const { messages, partsByMessageId } = useMessageImageCaptureMessages<CherryUIMessage>({
    loadMessages,
    mapMessage: passThroughUIMessage,
    onError: handleLoadError
  })

  const messageList = useHomeMessageListProviderValue({
    topic,
    messages: messages ?? [],
    partsByMessageId,
    isInitialLoading: false,
    imageActionConsumer: 'capture'
  })

  return (
    <MessageImageCaptureHost
      captureHostAttribute="data-topic-image-capture-host"
      messageList={messageList}
      ready={messages !== null}
      testId="topic-image-capture-host"
    />
  )
}

const TopicImageCaptureHost = ({ topic }: TopicImageCaptureHostProps) => (
  <MessageEditingProvider>
    <TopicImageCaptureHostContent topic={topic} />
  </MessageEditingProvider>
)

export default memo(TopicImageCaptureHost)
