import { loggerService } from '@logger'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { memo } from 'react'

const logger = loggerService.withContext('SessionsTab')

interface SessionsProps {
  agentId: string
}

const Sessions: React.FC<SessionsProps> = ({ agentId }) => {
  const { sessions } = useSessions(agentId)
  logger.debug('Sessions', sessions)

  return (
    <div className="agents-tab h-full w-full p-2">
      {/* TODO: Add session button */}
      Active Agent ID: {agentId}
      {sessions.map((session) => (
        <div key={session.id}>Not implemented</div>
      ))}
    </div>
  )
}

export default memo(Sessions)
