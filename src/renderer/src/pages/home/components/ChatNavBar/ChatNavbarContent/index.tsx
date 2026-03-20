import type { Assistant } from '@renderer/types'
import type { FC } from 'react'

import TopicContent from './TopicContent'

interface Props {
  assistant: Assistant
}

const ChatNavbarContent: FC<Props> = ({ assistant }) => {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between">
      <TopicContent assistant={assistant} />
    </div>
  )
}

export default ChatNavbarContent
