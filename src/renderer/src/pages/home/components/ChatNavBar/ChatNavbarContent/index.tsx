import type { FC } from 'react'

import TopicContent from './TopicContent'

interface Props {
  /** `undefined` when the topic has no associated assistant. */
  assistantId: string | undefined
  topicId: string
  onOpenSettings: () => void
}

const ChatNavbarContent: FC<Props> = ({ assistantId, topicId, onOpenSettings }) => {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between">
      <TopicContent assistantId={assistantId} topicId={topicId} onOpenSettings={onOpenSettings} />
    </div>
  )
}

export default ChatNavbarContent
