import { Scrollbar } from '@cherrystudio/ui'
import type { MessageListItem } from '@renderer/components/chat/messages'
import type { Assistant } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'

import Messages from './components/Messages'
interface Props {
  route: string
  assistant: Assistant | null
  isOutputted: boolean
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const ChatWindow: FC<Props> = ({ route, assistant, isOutputted, messages, partsByMessageId }) => {
  return (
    <Scrollbar className="bubble mb-auto flex max-h-full w-full flex-row justify-start bg-transparent! [-webkit-app-region:no-drag]">
      <Messages
        assistant={assistant}
        route={route}
        isOutputted={isOutputted}
        messages={messages}
        partsByMessageId={partsByMessageId}
      />
    </Scrollbar>
  )
}

export default ChatWindow
