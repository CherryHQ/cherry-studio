import { Button } from '@cherrystudio/ui'
import AddButton from '@renderer/components/AddButton'
import { ErrorState, LoadingState } from '@renderer/components/chat'
import DraggableVirtualList, { type DraggableVirtualListRef } from '@renderer/components/DraggableList/virtual-list'
import { useCache } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useSessions } from '@renderer/hooks/agents/useSessionDataApi'
import { formatErrorMessage } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { motion } from 'framer-motion'
import { throttle } from 'lodash'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem from './SessionItem'

interface SessionsProps {
  onSelectItem?: () => void
}

const LOAD_MORE_THRESHOLD = 100
const SCROLL_THROTTLE_DELAY = 150

export function resolveCreateSessionAgentId(
  sessions: AgentSessionEntity[],
  activeSessionId: string | null,
  agents: AgentEntity[]
): string | null {
  const activeAgentId = sessions.find((s) => s.id === activeSessionId)?.agentId
  return activeAgentId ?? sessions[0]?.agentId ?? agents[0]?.id ?? null
}

const Sessions = ({ onSelectItem }: SessionsProps) => {
  const { t } = useTranslation()
  const { agents } = useAgents()
  const {
    sessions,
    pinIdBySessionId,
    isLoading,
    error,
    deleteSession,
    hasMore,
    loadMore,
    isLoadingMore,
    isValidating,
    reload,
    reorderSessions,
    togglePin
  } = useSessions()
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')

  // Create-session entry: pick the agent of the currently-active session by
  // default, falling back to the agent owning the first listed session and then
  // the first available agent when no sessions exist yet.
  const fallbackAgentId = useMemo(
    () => resolveCreateSessionAgentId(sessions, activeSessionId, agents),
    [sessions, activeSessionId, agents]
  )
  const { createDefaultSession, creatingSession } = useCreateDefaultSession(fallbackAgentId)

  const listRef = useRef<DraggableVirtualListRef>(null)

  const { data: channels } = useQuery('/channels')
  const channelTypeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ch of channels ?? []) {
      if (ch.sessionId) map[ch.sessionId] = ch.type
    }
    return map
  }, [channels])

  const hasMoreRef = useRef(hasMore)
  const isLoadingMoreRef = useRef(isLoadingMore)
  const loadMoreRef = useRef(loadMore)
  hasMoreRef.current = hasMore
  isLoadingMoreRef.current = isLoadingMore
  loadMoreRef.current = loadMore

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

  useEffect(() => {
    const scrollElement = listRef.current?.scrollElement()
    if (!scrollElement) return
    scrollElement.addEventListener('scroll', handleScroll)
    return () => {
      handleScroll.cancel()
      scrollElement.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const success = await deleteSession(id)
      if (success && activeSessionId === id) {
        const remaining = sessions.find((s) => s.id !== id)
        setActiveSessionId(remaining?.id ?? null)
      }
    },
    [activeSessionId, deleteSession, sessions, setActiveSessionId]
  )

  // Cold start: seed the active pointer from the first available session if
  // nothing is set. `useAgentSessionInitializer` (in AgentPage) does the same
  // via a direct fetch — whichever runs first wins, the other is a no-op.
  useEffect(() => {
    if (!isLoading && sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id)
    }
  }, [isLoading, sessions, activeSessionId, setActiveSessionId])

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex h-full items-center justify-center">
        <LoadingState />
      </motion.div>
    )
  }

  if (error) {
    return (
      <ErrorState
        className="m-2.5"
        title={t('agent.session.get.error.failed')}
        description={formatErrorMessage(error)}
        action={
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={isValidating}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <DraggableVirtualList
        ref={listRef}
        className="sessions-tab flex min-h-0 flex-1 flex-col"
        itemStyle={{ marginBottom: 8 }}
        list={sessions}
        estimateSize={() => 9 * 4}
        scrollerStyle={{ overflowX: 'hidden', padding: '12px 10px' }}
        onUpdate={reorderSessions}
        itemKey={(index) => sessions[index]?.id ?? index}
        header={
          <div className="-mt-0.5 mb-1.5">
            <AddButton className="w-full" onClick={createDefaultSession} disabled={creatingSession || !fallbackAgentId}>
              {t('agent.session.add.title')}
            </AddButton>
          </div>
        }>
        {(session) => (
          <SessionItem
            key={session.id}
            session={session}
            channelType={channelTypeMap[session.id]}
            pinned={pinIdBySessionId.has(session.id)}
            onTogglePin={() => togglePin(session.id)}
            onDelete={() => handleDeleteSession(session.id)}
            onPress={() => {
              setActiveSessionId(session.id)
              onSelectItem?.()
            }}
          />
        )}
      </DraggableVirtualList>
      {isLoadingMore && (
        <div className="flex justify-center py-2">
          <LoadingState />
        </div>
      )}
    </div>
  )
}

export default memo(Sessions)
