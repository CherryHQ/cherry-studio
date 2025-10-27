import { Alert, Spinner } from '@heroui/react'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import {
  setActiveSessionIdAction,
  setActiveTopicOrSessionAction,
  setSessionWaitingAction
} from '@renderer/store/runtime'
import { CreateSessionForm } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { motion } from 'framer-motion'
import { memo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import AddButton from './AddButton'
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
  const { activeSessionIdMap } = chat
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
      id: undefined,
      name: t('common.unnamed')
    } satisfies CreateSessionForm
    const created = await createSession(session)
    if (created) {
      dispatch(setActiveSessionIdAction({ agentId, sessionId: created.id }))
    }
  }, [agent, agentId, createSession, dispatch, t])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (sessions.length === 1) {
        window.toast.error(t('agent.session.delete.error.last'))
        return
      }
      dispatch(setSessionWaitingAction({ id, value: true }))
      const success = await deleteSession(id)
      if (success) {
        const newSessionId = sessions.find((s) => s.id !== id)?.id
        if (newSessionId) {
          dispatch(setActiveSessionIdAction({ agentId, sessionId: newSessionId }))
        } else {
          // may clear messages instead of forbidden deletion
        }
      }
      dispatch(setSessionWaitingAction({ id, value: false }))
    },
    [agentId, deleteSession, dispatch, sessions, t]
  )

  const activeSessionId = activeSessionIdMap[agentId]

  useEffect(() => {
    if (!isLoading && sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(agentId, sessions[0].id)
    }
  }, [isLoading, sessions, activeSessionId, agentId, setActiveSessionId])

  useEffect(() => {
    if (activeSessionId) {
      dispatch(
        newMessagesActions.setTopicFulfilled({
          topicId: buildAgentSessionTopicId(activeSessionId),
          fulfilled: false
        })
      )
    }
  }, [activeSessionId, dispatch])

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
    <div className="sessions-tab flex h-full w-full flex-col p-2">
      <AddButton onPress={handleCreateSession} className="mb-2">
        {t('agent.session.add.title')}
      </AddButton>
      {/* h-9 */}
      <DynamicVirtualList
        list={sessions}
        estimateSize={() => 9 * 4}
        scrollerStyle={{
          // FIXME: This component only supports CSSProperties
          overflowX: 'hidden'
        }}
        autoHideScrollbar>
        {(session) => (
          <SessionItem
            key={session.id}
            session={session}
            agentId={agentId}
            onDelete={() => handleDeleteSession(session.id)}
            onPress={() => setActiveSessionId(agentId, session.id)}
          />
        )}
      </DynamicVirtualList>
    </div>
  )
}

export default memo(Sessions)
