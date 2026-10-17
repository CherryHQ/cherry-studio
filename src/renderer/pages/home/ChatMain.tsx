import { type FC, useMemo } from 'react'

import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type {
  MessageListActions,
  MessageListSelectAllPagination,
  MessageStreamingLayers
} from '@renderer/components/chat/messages/types'
import { useStableStringArray } from '@renderer/hooks/useStableStringArray'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { useHomeMessageListProviderValue } from './messages/homeMessageListAdapter'
import { TopicPendingAttachments } from './messages/TopicPendingAttachments'

interface ChatMainProps {
  topic: Topic
  assistant?: Assistant
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers: MessageStreamingLayers
  onBindRuntime: NonNullable<MessageListActions['bindRuntime']>
  isInitialLoading?: boolean
  isMessagesStale?: boolean
  loadOlder: () => void
  hasOlder: boolean
  selectAllPagination?: MessageListSelectAllPagination
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  onStartBranchDraft?: MessageListActions['startMessageBranch']
}

const ChatMain: FC<ChatMainProps> = ({
  topic,
  assistant,
  messages,
  partsByMessageId,
  streamingLayers,
  onBindRuntime,
  isInitialLoading,
  isMessagesStale,
  loadOlder,
  hasOlder,
  selectAllPagination,
  openCitationsPanel,
  onStartBranchDraft
}) => {
  const messageIds = useStableStringArray(messages.map((message) => message.id))
  const afterMessages = useMemo(
    () => <TopicPendingAttachments key={topic.id} topicId={topic.id} messageIds={messageIds} />,
    [messageIds, topic.id]
  )
  const value = useHomeMessageListProviderValue({
    topic,
    assistant,
    messages,
    partsByMessageId,
    streamingLayers,
    onBindRuntime,
    isInitialLoading,
    isMessagesStale,
    loadOlder,
    hasOlder,
    selectAllPagination,
    openCitationsPanel,
    onStartBranchDraft,
    afterMessages
  })
  return (
    <MessageListProvider value={value}>
      <MessageList enableSearch />
    </MessageListProvider>
  )
}

export default ChatMain
