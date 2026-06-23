import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { FC } from 'react'

import { useHomeMessageListProviderValue } from './messages/homeMessageListAdapter'

interface ChatMainProps {
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  isInitialLoading?: boolean
  loadOlder: () => void
  hasOlder: boolean
  openCitationsPanel?: MessageListActions['openCitationsPanel']
}

const ChatMain: FC<ChatMainProps> = ({
  topic,
  messages,
  partsByMessageId,
  isInitialLoading,
  loadOlder,
  hasOlder,
  openCitationsPanel
}) => {
  const value = useHomeMessageListProviderValue({
    topic,
    messages,
    partsByMessageId,
    isInitialLoading,
    loadOlder,
    hasOlder,
    openCitationsPanel
  })
  return (
    <MessageListProvider value={value}>
      <MessageList />
    </MessageListProvider>
  )
}

export default ChatMain
