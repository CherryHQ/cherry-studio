import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { cacheService } from '@renderer/data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
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
  const [activeSessionIdMap] = useCache('agent.session.active_id_map')
  const dispatch = useAppDispatch()
  const { createDefaultSession, creatingSession } = useCreateDefaultSession(agentId)

  const setActiveSessionId = useCallback((agentId: string, sessionId: string | null) => {
    const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
    cacheService.set('agent.session.active_id_map', { ...currentMap, [agentId]: sessionId })
    cacheService.set('chat.active_view', 'session')
  }, [])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (sessions.length === 1) {
        window.toast.error(t('agent.session.delete.error.last'))
        return
      }
      const waitingMap = cacheService.get('agent.session.waiting_id_map') ?? {}
      cacheService.set('agent.session.waiting_id_map', { ...waitingMap, [id]: true })
      const success = await deleteSession(id)
      if (success) {
        const newSessionId = sessions.find((s) => s.id !== id)?.id
        if (newSessionId) {
          const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
          cacheService.set('agent.session.active_id_map', { ...currentMap, [agentId]: newSessionId })
        } else {
          // may clear messages instead of forbidden deletion
        }
      }
      const updatedMap = cacheService.get('agent.session.waiting_id_map') ?? {}
      cacheService.set('agent.session.waiting_id_map', { ...updatedMap, [id]: false })
    },
    [agentId, deleteSession, sessions, t]
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
    <StyledVirtualList
      className="sessions-tab"
      list={sessions}
      estimateSize={() => 9 * 4}
      // FIXME: This component only supports CSSProperties
      scrollerStyle={{ overflowX: 'hidden' }}
      autoHideScrollbar
      header={
        <AddButton onClick={createDefaultSession} disabled={creatingSession} className="-mt-[4px] mb-[6px]">
          {t('agent.session.add.title')}
        </AddButton>
      }>
      {(session) => (
        <SessionItem
          key={session.id}
          session={session}
          agentId={agentId}
          onDelete={() => handleDeleteSession(session.id)}
          onPress={() => setActiveSessionId(agentId, session.id)}
        />
      )}
    </StyledVirtualList>
  )
}

const StyledVirtualList = styled(DynamicVirtualList)`
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  height: 100%;
` as typeof DynamicVirtualList

export default memo(Sessions)
