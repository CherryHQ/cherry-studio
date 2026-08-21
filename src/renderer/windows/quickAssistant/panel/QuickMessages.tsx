import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'

import { useQuickMessageListProviderValue } from '../messages/quickMessageListAdapter'

interface Props {
  topic: Topic
  assistant?: Assistant
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

/**
 * The expanded panel's conversation view — the same `MessageList` the main window
 * renders, so a quick answer looks exactly like a chat one. Loaded lazily: it pulls in
 * the markdown / katex / mermaid chain, which the collapsed bar must not pay for.
 */
const QuickMessages: FC<Props> = ({ topic, assistant, messages, partsByMessageId }) => {
  const value = useQuickMessageListProviderValue({ topic, assistant, messages, partsByMessageId })

  return (
    <MessageListProvider value={value}>
      <MessageList />
    </MessageListProvider>
  )
}

export default QuickMessages
