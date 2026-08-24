import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type { MessageListActions, MessageStreamingLayers } from '@renderer/components/chat/messages/types'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { FC } from 'react'

import { useHomeMessageListProviderValue } from './messages/homeMessageListAdapter'

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
  openCitationsPanel,
  onStartBranchDraft
}) => {
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
    openCitationsPanel,
    onStartBranchDraft
  })
  return (
    <MessageListProvider value={value}>
      <MessageList enableSearch />
    </MessageListProvider>
  )
}

export default ChatMain
