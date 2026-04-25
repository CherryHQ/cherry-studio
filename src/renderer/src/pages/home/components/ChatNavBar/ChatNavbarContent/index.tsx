import type { FC } from 'react'

import TopicContent from './TopicContent'

interface Props {
  assistantId: string
}

const ChatNavbarContent: FC<Props> = ({ assistantId }) => {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between">
      <TopicContent assistantId={assistantId} />
    </div>
  )
}

export default ChatNavbarContent
