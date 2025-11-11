import Scrollbar from '@renderer/components/Scrollbar'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import {
  setActiveSessionIdAction,
  setActiveTopicOrSessionAction,
  setSessionWaitingAction
} from '@renderer/store/runtime'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Alert, Spin } from 'antd'
import { motion } from 'framer-motion'
import { memo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AddButton from './AddButton'
import SessionItem from './SessionItem'

// const logger = loggerService.withContext('SessionsTab')

interface SessionsProps {
  agentId: string
}

const Sessions: React.FC<SessionsProps> = ({ agentId }) => {
  const { t } = useTranslation()
  const { sessions, isLoading, error, deleteSession } = useSessions(agentId)
  const { chat } = useRuntime()
  const { activeSessionIdMap } = chat
  const dispatch = useAppDispatch()
  const { createDefaultSession, creatingSession } = useCreateDefaultSession(agentId)

  const setActiveSessionId = useCallback(
    (agentId: string, sessionId: string | null) => {
      dispatch(setActiveSessionIdAction({ agentId, sessionId }))
      dispatch(setActiveTopicOrSessionAction('session'))
    },
    [dispatch]
  )

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
        <Spin />
      </motion.div>
    )
  }

  if (error) {
    return <Alert type="error" message={t('agent.session.get.error.failed')} showIcon style={{ margin: 10 }} />
  }

  return (
    <Container className="sessions-tab">
      <AddButton onClick={createDefaultSession} disabled={creatingSession} className="-mt-[4px] mb-[6px]">
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
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  overflow-x: hidden;
`

export default memo(Sessions)
