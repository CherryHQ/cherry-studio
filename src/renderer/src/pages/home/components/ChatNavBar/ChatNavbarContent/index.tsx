import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useRuntime } from '@renderer/hooks/useRuntime'
import type { Assistant } from '@renderer/types'
import type { FC } from 'react'

import AgentContent from './AgentContent'
import TopicContent from './TopicContent'

interface Props {
  assistant: Assistant
}

const ChatNavbarContent: FC<Props> = ({ assistant }) => {
  const { chat } = useRuntime()
  const { activeTopicOrSession } = chat
  const { agent: activeAgent } = useActiveAgent()

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between">
      {activeTopicOrSession === 'topic' && <TopicContent assistant={assistant} />}
      {activeTopicOrSession === 'session' && activeAgent && <AgentContent activeAgent={activeAgent} />}
    </div>
  )
}

export default ChatNavbarContent
