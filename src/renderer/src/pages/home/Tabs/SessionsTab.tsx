import { useRuntime } from '@renderer/hooks/useRuntime'
import { FC, memo } from 'react'

import Sessions from './components/Sessions'

interface SessionsTabProps {}

const SessionsTab: FC<SessionsTabProps> = () => {
  const { chat } = useRuntime()
  const { activeAgentId } = chat

  if (!activeAgentId) {
    return <div> No active agent.</div>
  }

  return (
    <>
      <Sessions agentId={activeAgentId} />
    </>
  )
}

export default memo(SessionsTab)
