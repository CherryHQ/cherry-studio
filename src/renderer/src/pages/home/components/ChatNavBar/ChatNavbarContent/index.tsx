import type { FC } from 'react'

import TopicContent from './TopicContent'

interface Props {
  assistantId: string
  topicId: string
}

const ChatNavbarContent: FC<Props> = ({ assistantId, topicId }) => {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between">
      <TopicContent assistantId={assistantId} topicId={topicId} />
    </div>
  )
}

export default ChatNavbarContent
