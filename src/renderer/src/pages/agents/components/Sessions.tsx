import { Button } from '@cherrystudio/ui'
import AddButton from '@renderer/components/AddButton'
import DraggableVirtualList, { type DraggableVirtualListRef } from '@renderer/components/DraggableList/virtual-list'
import { useCache } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useSessions } from '@renderer/hooks/agents/useSessionDataApi'
import { formatErrorMessage } from '@renderer/utils/error'
import { motion } from 'framer-motion'
import { throttle } from 'lodash'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem from './SessionItem'

interface SessionsProps {
  onSelectItem?: () => void
}

const LOAD_MORE_THRESHOLD = 100
const SCROLL_THROTTLE_DELAY = 150

const Sessions = ({ onSelectItem }: SessionsProps) => {
  const { t } = useTranslation()
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
  // default, falling back to the agent owning the first listed session.
  const fallbackAgentId = useMemo(() => {
    const activeAgentId = sessions.find((s) => s.id === activeSessionId)?.agentId
    return activeAgentId ?? sessions[0]?.agentId ?? null
  }, [sessions, activeSessionId])
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
        <Loader2 className="size-5 animate-spin text-(--color-text-3)" />
      </motion.div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="m-2.5 flex items-start gap-2 rounded-md border border-(--color-error) bg-(--color-error)/10 px-3 py-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-(--color-error)" />
        <div className="flex flex-1 flex-col gap-1">
          <div className="font-medium">{t('agent.session.get.error.failed')}</div>
          <div className="text-(--color-text-3) text-xs">{formatErrorMessage(error)}</div>
          <div>
            <Button size="sm" variant="outline" onClick={() => void reload()} disabled={isValidating}>
              {t('common.retry')}
            </Button>
          </div>
        </div>
      </div>
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
          <Loader2 className="size-4 animate-spin text-(--color-text-3)" />
        </div>
      )}
    </div>
  )
}

export default memo(Sessions)
