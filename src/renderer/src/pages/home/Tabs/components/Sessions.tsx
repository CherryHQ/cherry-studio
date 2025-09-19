import { Spinner } from '@heroui/react'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useAppDispatch } from '@renderer/store'
import { setActiveSessionIdAction } from '@renderer/store/runtime'
import { memo, useCallback } from 'react'

import SessionItem from './SessionItem'

// const logger = loggerService.withContext('SessionsTab')

interface SessionsProps {
  agentId: string
}

const Sessions: React.FC<SessionsProps> = ({ agentId }) => {
  const { sessions, isLoading, deleteSession } = useSessions(agentId)
  const dispatch = useAppDispatch()

  const setActiveSessionId = useCallback(
    (agentId: string, sessionId: string | null) => {
      dispatch(setActiveSessionIdAction({ agentId, sessionId }))
    },
    [dispatch]
  )

  if (isLoading) return <Spinner />

  // if (error) return

  return (
    <div className="agents-tab h-full w-full p-2">
      {/* TODO: Add session button */}
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          agentId={agentId}
          onDelete={() => deleteSession(session.id)}
          onPress={() => setActiveSessionId(agentId, session.id)}
        />
      ))}
    </div>
  )
}

export default memo(Sessions)
