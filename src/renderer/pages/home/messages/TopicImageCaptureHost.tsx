import { loggerService } from '@logger'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { getTopicMessages } from '@renderer/hooks/useTopic'
import type { Topic } from '@renderer/types/topic'
import { createPartsByMessageId, exportViewToUIMessage } from '@renderer/utils/message/exportView'
import type { CherryUIMessage } from '@shared/data/types/message'
import { memo, useEffect, useMemo, useState } from 'react'

import { useHomeMessageListProviderValue } from './homeMessageListAdapter'
import { rejectPendingTopicImageActions } from './topicImageActionBus'

const logger = loggerService.withContext('TopicImageCaptureHost')

interface TopicImageCaptureHostProps {
  topic: Topic
}

const TopicImageCaptureHost = ({ topic }: TopicImageCaptureHostProps) => {
  const [messages, setMessages] = useState<CherryUIMessage[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setMessages(null)

    void getTopicMessages(topic.id)
      .then((exportMessages) => {
        if (!cancelled) setMessages(exportMessages.map(exportViewToUIMessage))
      })
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to load topic messages for image capture', error as Error, {
          topicId: topic.id
        })
        rejectPendingTopicImageActions(topic.id, error)
      })

    return () => {
      cancelled = true
    }
  }, [topic.id])

  const partsByMessageId = useMemo(() => (messages ? createPartsByMessageId(messages) : {}), [messages])

  const messageList = useHomeMessageListProviderValue({
    topic,
    messages: messages ?? [],
    partsByMessageId,
    isInitialLoading: false,
    imageActionConsumer: 'capture'
  })

  if (!messages) return null

  return (
    <div
      aria-hidden="true"
      className="-left-[10000px] pointer-events-none fixed top-0 h-px w-[960px] overflow-hidden bg-background text-foreground"
      data-topic-image-capture-host>
      <MessageListProvider value={messageList}>
        <MessageList />
      </MessageListProvider>
    </div>
  )
}

export default memo(TopicImageCaptureHost)
