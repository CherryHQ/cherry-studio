import { loggerService } from '@logger'
import { MessageEditingProvider } from '@renderer/components/chat/editing/MessageEditingContext'
import { useMessageImageCaptureMessages } from '@renderer/components/chat/messages/hooks/useMessageImageCaptureMessages'
import MessageImageCaptureHost from '@renderer/components/chat/messages/MessageImageCaptureHost'
import { getTopicMessages } from '@renderer/hooks/useTopic'
import type { Topic } from '@renderer/types/topic'
import { memo, useCallback } from 'react'

import { useHomeMessageListProviderValue } from './homeMessageListAdapter'
import { rejectPendingTopicImageActions } from './topicImageActionBus'

const logger = loggerService.withContext('TopicImageCaptureHost')

interface TopicImageCaptureHostProps {
  topic: Topic
}

const TopicImageCaptureHostContent = ({ topic }: TopicImageCaptureHostProps) => {
  const loadMessages = useCallback(() => getTopicMessages(topic.id), [topic.id])
  const handleLoadError = useCallback(
    (error: unknown) => {
      logger.error('Failed to load topic messages for image capture', error as Error, {
        topicId: topic.id
      })
      rejectPendingTopicImageActions(topic.id, error)
    },
    [topic.id]
  )
  const { messages, partsByMessageId } = useMessageImageCaptureMessages({
    loadMessages,
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
