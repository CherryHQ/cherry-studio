import type { FC } from 'react'

import { Scrollbar } from '@cherrystudio/ui'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { Assistant } from '@renderer/types/assistant'
import type { CherryMessagePart } from '@shared/data/types/message'

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
    // Only the stationary viewport excludes dragging; inherited regions move outside it when scrolled.
    <Scrollbar className="bubble mb-auto flex max-h-full w-full flex-row justify-start bg-transparent! [-webkit-app-region:no-drag] [&_*]:[-webkit-app-region:initial]">
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
