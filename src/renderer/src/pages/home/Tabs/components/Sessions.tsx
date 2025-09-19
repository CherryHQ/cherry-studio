import { Button, Spinner } from '@heroui/react'
import { SessionModal } from '@renderer/components/Popups/agent/SessionModal'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useAppDispatch } from '@renderer/store'
import { setActiveSessionIdAction, setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import { Plus } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem from './SessionItem'

// const logger = loggerService.withContext('SessionsTab')

interface SessionsProps {
  agentId: string
}

const Sessions: React.FC<SessionsProps> = ({ agentId }) => {
  const { t } = useTranslation()
  const { sessions, isLoading, deleteSession } = useSessions(agentId)
  const dispatch = useAppDispatch()

  const setActiveSessionId = useCallback(
    (agentId: string, sessionId: string | null) => {
      dispatch(setActiveSessionIdAction({ agentId, sessionId }))
      dispatch(setActiveTopicOrSessionAction('session'))
    },
    [dispatch]
  )

  if (isLoading) return <Spinner />

  // if (error) return

  return (
    <div className="agents-tab h-full w-full p-2">
      {/* TODO: Add session button */}
      <SessionModal
        agentId={agentId}
        trigger={{
          content: (
            <Button
              onPress={(e) => e.continuePropagation()}
              className="mb-2 w-full justify-start bg-transparent text-foreground-500 hover:bg-accent">
              <Plus size={16} className="mr-1 shrink-0" />
              {t('agent.session.add.title')}
            </Button>
          )
        }}
      />
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
