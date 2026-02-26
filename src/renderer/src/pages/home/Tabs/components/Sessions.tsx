import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
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
import { formatErrorMessage } from '@renderer/utils/error'
import { Alert, Button, Spin } from 'antd'
import { motion } from 'framer-motion'
import { throttle } from 'lodash'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AddButton from './AddButton'
import SessionItem from './SessionItem'

interface SessionsProps {
  agentId: string
}

const LOAD_MORE_THRESHOLD = 100
const SCROLL_THROTTLE_DELAY = 150

const Sessions: React.FC<SessionsProps> = ({ agentId }) => {
  const { t } = useTranslation()
  const { sessions, isLoading, error, deleteSession, hasMore, loadMore, isLoadingMore, isValidating, reload } =
    useSessions(agentId)
  const { chat } = useRuntime()
  const { activeSessionIdMap } = chat
  const dispatch = useAppDispatch()
  const { createDefaultSession, creatingSession } = useCreateDefaultSession(agentId)
  const listRef = useRef<DynamicVirtualListRef>(null)

  // Use refs to always read the latest values inside the throttled handler,
  // avoiding stale closures caused by recreating the throttle on each render.
  const hasMoreRef = useRef(hasMore)
  const isLoadingMoreRef = useRef(isLoadingMore)
  const loadMoreRef = useRef(loadMore)
  hasMoreRef.current = hasMore
  isLoadingMoreRef.current = isLoadingMore
  loadMoreRef.current = loadMore

  // Create the throttle once — refs ensure it always sees fresh state.
  const handleScroll = useMemo(
    () =>
      throttle(() => {
        const scrollElement = listRef.current?.scrollElement()
        if (!scrollElement) return

        const { scrollTop, scrollHeight, clientHeight } = scrollElement
        if (
          scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD &&
          hasMoreRef.current &&
          !isLoadingMoreRef.current
        ) {
          loadMoreRef.current()
        }
      }, SCROLL_THROTTLE_DELAY),
    []
  )

  // Handle scroll to load more
  useEffect(() => {
    const scrollElement = listRef.current?.scrollElement()
    if (!scrollElement) return

    scrollElement.addEventListener('scroll', handleScroll)
    return () => {
      handleScroll.cancel()
      scrollElement.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

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
    return (
      <Alert
        type="error"
        message={t('agent.session.get.error.failed')}
        description={formatErrorMessage(error)}
        showIcon
        style={{ margin: 10 }}
        action={
          <Button size="small" onClick={() => void reload()} disabled={isValidating}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <StyledVirtualList
        ref={listRef}
        className="sessions-tab"
        list={sessions}
        estimateSize={() => 9 * 4}
        // FIXME: This component only supports CSSProperties
        scrollerStyle={{ overflowX: 'hidden' }}
        autoHideScrollbar
        header={
          <div className="mt-0.5">
            <AddButton onClick={createDefaultSession} disabled={creatingSession} className="-mt-1 mb-1.5">
              {t('agent.session.add.title')}
            </AddButton>
          </div>
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
      {isLoadingMore && (
        <div className="flex justify-center py-2">
          <Spin size="small" />
        </div>
      )}
    </div>
  )
}

const StyledVirtualList = styled(DynamicVirtualList)`
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  flex: 1;
  min-height: 0;
` as typeof DynamicVirtualList

export default memo(Sessions)
