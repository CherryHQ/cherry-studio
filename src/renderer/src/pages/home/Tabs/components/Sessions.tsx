import { Alert, Button, Spinner } from '@heroui/react'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import { setActiveSessionIdAction, setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import { CreateSessionForm } from '@renderer/types'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { memo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem from './SessionItem'

// const logger = loggerService.withContext('SessionsTab')

interface SessionsProps {
  agentId: string
}

const Sessions: React.FC<SessionsProps> = ({ agentId }) => {
  const { t } = useTranslation()
  const { agent } = useAgent(agentId)
  const { sessions, isLoading, error, deleteSession, createSession } = useSessions(agentId)
  const { chat } = useRuntime()
  const { activeSessionId } = chat
  const dispatch = useAppDispatch()

  const setActiveSessionId = useCallback(
    (agentId: string, sessionId: string | null) => {
      dispatch(setActiveSessionIdAction({ agentId, sessionId }))
      dispatch(setActiveTopicOrSessionAction('session'))
    },
    [dispatch]
  )

  const handleCreateSession = useCallback(async () => {
    if (!agent) return
    const session = {
      ...agent,
      id: undefined
    } satisfies CreateSessionForm
    const created = await createSession(session)
    if (created) {
      dispatch(setActiveSessionIdAction({ agentId, sessionId: created.id }))
    }
  }, [agent, agentId, createSession, dispatch])

  const currentActiveSessionId = activeSessionId[agentId]

  useEffect(() => {
    if (!isLoading && sessions.length > 0 && !currentActiveSessionId) {
      setActiveSessionId(agentId, sessions[0].id)
    }
  }, [isLoading, sessions, currentActiveSessionId, agentId, setActiveSessionId])

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </motion.div>
    )
  }

  if (error) return <Alert color="danger" content={t('agent.session.get.error.failed')} />

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="agents-tab h-full w-full p-2">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.1 }}>
        <Button
          onPress={handleCreateSession}
          className="mb-2 w-full justify-start bg-transparent text-foreground-500 hover:bg-accent">
          <Plus size={16} className="mr-1 shrink-0" />
          {t('agent.session.add.title')}
        </Button>
      </motion.div>
      <AnimatePresence>
        {sessions.map((session, index) => (
          <motion.div
            key={session.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3, delay: index * 0.05 }}>
            <SessionItem
              session={session}
              agentId={agentId}
              onDelete={() => deleteSession(session.id)}
              onPress={() => setActiveSessionId(agentId, session.id)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  )
}

export default memo(Sessions)
