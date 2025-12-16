import { DraggableVirtualList, type DraggableVirtualListRef } from '@renderer/components/DraggableList'
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
import { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import AddButton from './AddButton'
import SessionItem from './SessionItem'

interface SessionsProps {
  agentId: string
}

const Sessions: React.FC<SessionsProps> = ({ agentId }) => {
  const { t } = useTranslation()
  const { sessions, isLoading, error, deleteSession, hasMore, loadMore, isLoadingMore, total } = useSessions(agentId)
  const { chat } = useRuntime()
  const { activeSessionIdMap } = chat
  const dispatch = useAppDispatch()
  const { createDefaultSession, creatingSession } = useCreateDefaultSession(agentId)
  const listRef = useRef<DraggableVirtualListRef>(null)

  // Handle scroll to load more
  useEffect(() => {
    const scrollElement = listRef.current?.scrollElement()
    if (!scrollElement) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement
      // Load more when scrolled to bottom (with 100px threshold)
      if (scrollHeight - scrollTop - clientHeight < 100 && hasMore && !isLoadingMore) {
        loadMore()
      }
    }

    scrollElement.addEventListener('scroll', handleScroll)
    return () => scrollElement.removeEventListener('scroll', handleScroll)
  }, [hasMore, isLoadingMore, loadMore])

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
    <DraggableVirtualList
      ref={listRef}
      className="sessions-tab"
      list={sessions}
      disabled
      style={{ height: '100%', padding: '9px 0 10px 10px' }}
      itemContainerStyle={{ paddingBottom: '8px' }}
      header={
        <>
          <AddButton onClick={createDefaultSession} disabled={creatingSession}>
            {t('agent.session.add.title')}
          </AddButton>
          <div className="my-1"></div>
        </>
      }>
      {(session, index) => (
        <>
          <SessionItem
            key={session.id}
            session={session}
            agentId={agentId}
            onDelete={() => handleDeleteSession(session.id)}
            onPress={() => setActiveSessionId(agentId, session.id)}
          />
          {index === sessions.length - 1 && isLoadingMore && (
            <div className="flex justify-center py-2">
              <Spin size="small" />
            </div>
          )}
        </>
      )}
    </DraggableVirtualList>
  )
}

export default memo(Sessions)
