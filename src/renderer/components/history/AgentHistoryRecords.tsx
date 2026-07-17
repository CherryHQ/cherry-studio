import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { SessionActionContext } from '@renderer/components/chat/actions/sessionItemActions'
import { useResourceListPinnedItems } from '@renderer/components/chat/resourceList/base'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { AgentSelector } from '@renderer/components/resourceCatalog/selectors'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionStats, useSessions, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { createSessionActionContext, useSessionMenuPreset } from '@renderer/hooks/chat/useSessionMenuActions'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useDebouncedValue } from '@renderer/hooks/useDebouncedValue'
import { usePinMutations } from '@renderer/hooks/usePins'
import { toast } from '@renderer/services/toast'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { SessionListItem } from '@renderer/utils/chat/sessionListHelpers'
import type { AgentSessionEntity, AgentSessionListItem } from '@shared/data/api/schemas/agentSessions'
import { type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HistoryRecordsContent } from './components/HistoryRecordsContent'
import { HistorySourceFilterField } from './components/HistorySourceFilter'
import { HistoryActionContextMenu } from './components/HistoryTableParts'
import type { HistoryRecordDescriptor, HistoryRowActions } from './historyRecordsDescriptor'
import {
  ALL_SOURCE_ID,
  buildAgentSources,
  findAdjacentHistoryRecordAfterBulkDelete,
  toServerOwnerScope
} from './historyRecordsHelpers'
import { useHistoryRecordsController, useHistoryRecordsFilters } from './useHistoryRecordsController'
import { usePinnedBandPagination } from './usePinnedBandPagination'

const SEARCH_DEBOUNCE_MS = 300
const HISTORY_PAGE_SIZE = 50
const logger = loggerService.withContext('AgentHistoryRecords')

interface AgentHistoryRecordsProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (sessionId: string | null) => void
  toolbarLeading?: ReactNode
}

const AgentHistoryRecords = ({ activeRecordId, onClose, onRecordSelect, toolbarLeading }: AgentHistoryRecordsProps) => {
  const { t } = useTranslation()
  const conversationNav = useConversationNavigation('agents')

  const filters = useHistoryRecordsFilters()
  const debouncedSearch = useDebouncedValue(filters.searchText, SEARCH_DEBOUNCE_MS)
  const ownerScope = toServerOwnerScope(filters.selectedSourceId)
  const bandContinuityKey = JSON.stringify({ ownerScope, q: debouncedSearch })
  const historySortBy = 'createdAt' as const

  const pinnedSessionsSource = useSessions(ownerScope, {
    pageSize: HISTORY_PAGE_SIZE,
    q: debouncedSearch,
    searchScope: 'name-or-owner',
    pinned: true
  })
  const unpinnedSessionsSource = useSessions(ownerScope, {
    pageSize: HISTORY_PAGE_SIZE,
    q: debouncedSearch,
    searchScope: 'name-or-owner',
    sortBy: historySortBy,
    pinned: false
  })
  const { deleteSession, deleteSessions } = unpinnedSessionsSource
  const {
    items: sourceBandSessions,
    error: sessionError,
    isLoading: isSessionsLoading,
    isLoadingMore: isSessionsLoadingMore,
    hasNext: hasMoreSessions,
    loadNext: loadMoreBandSessions,
    reload: reloadBandSessions
  } = usePinnedBandPagination(
    {
      items: pinnedSessionsSource.sessions,
      error: pinnedSessionsSource.error,
      hasNext: pinnedSessionsSource.hasMore,
      isLoading: pinnedSessionsSource.isLoading,
      isLoadingMore: pinnedSessionsSource.isLoadingMore,
      loadNext: pinnedSessionsSource.loadMore,
      reload: pinnedSessionsSource.reload
    },
    {
      items: unpinnedSessionsSource.sessions,
      error: unpinnedSessionsSource.error,
      hasNext: unpinnedSessionsSource.hasMore,
      isLoading: unpinnedSessionsSource.isLoading,
      isLoadingMore: unpinnedSessionsSource.isLoadingMore,
      loadNext: unpinnedSessionsSource.loadMore,
      reload: unpinnedSessionsSource.reload
    },
    { continuityKey: bandContinuityKey }
  )
  const { agents } = useAgents()
  const { stats: sessionStats } = useAgentSessionStats()
  const { updateSession } = useUpdateSession()
  const { pin: pinSession, unpin: unpinSession, isMutating: isPinMutating } = usePinMutations('session')
  const commitSessionPin = useCallback(
    async (session: AgentSessionListItem) => {
      if (session.pinId) await unpinSession(session.pinId)
      else await pinSession(session.id)
    },
    [pinSession, unpinSession]
  )
  const { items: projectedBandSessions, togglePinned: togglePinnedSessionItem } = useResourceListPinnedItems({
    disabled: isPinMutating,
    items: sourceBandSessions,
    onTogglePin: commitSessionPin,
    resetKey: bandContinuityKey
  })
  const [optimisticallyRemovedSessionIds, setOptimisticallyRemovedSessionIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [optimisticSessionNames, setOptimisticSessionNames] = useState<Record<string, string>>({})
  const projectedBandSessionById = useMemo(
    () => new Map(projectedBandSessions.map((session) => [session.id, session])),
    [projectedBandSessions]
  )

  useEffect(() => {
    setOptimisticallyRemovedSessionIds(new Set())
    setOptimisticSessionNames({})
  }, [bandContinuityKey])

  useEffect(() => {
    setOptimisticallyRemovedSessionIds((current) => {
      const next = new Set([...current].filter((id) => projectedBandSessionById.has(id)))
      return next.size === current.size ? current : next
    })
    setOptimisticSessionNames((current) => {
      let changed = false
      const next = { ...current }
      for (const [id, name] of Object.entries(current)) {
        if (projectedBandSessionById.get(id)?.name === name) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [projectedBandSessionById])
  const sessions = useMemo(
    () => [
      ...projectedBandSessions
        .filter((session) => !optimisticallyRemovedSessionIds.has(session.id) && session.pinned)
        .map((session) =>
          optimisticSessionNames[session.id] ? { ...session, name: optimisticSessionNames[session.id] } : session
        ),
      ...projectedBandSessions
        .filter((session) => !optimisticallyRemovedSessionIds.has(session.id) && !session.pinned)
        .map((session) =>
          optimisticSessionNames[session.id] ? { ...session, name: optimisticSessionNames[session.id] } : session
        )
    ],
    [optimisticSessionNames, optimisticallyRemovedSessionIds, projectedBandSessions]
  )

  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const isSessionPinned = useCallback((sessionId: string) => sessionById.get(sessionId)?.pinned === true, [sessionById])
  const sessionItems = useMemo<SessionListItem[]>(() => [...sessions], [sessions])
  const loadMoreSessions = useCallback(() => {
    if (isSessionsLoading || isSessionsLoadingMore || sessionError) return
    loadMoreBandSessions()
  }, [isSessionsLoading, isSessionsLoadingMore, loadMoreBandSessions, sessionError])
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const agentRankById = useMemo(() => new Map(agents.map((agent, index) => [agent.id, index])), [agents])
  const activeRecordIdRef = useRef(activeRecordId)
  useEffect(() => {
    activeRecordIdRef.current = activeRecordId
  }, [activeRecordId])
  const selectActiveSession = useCallback(
    (sessionId: string | null) => {
      activeRecordIdRef.current = sessionId
      onRecordSelect?.(sessionId)
    },
    [onRecordSelect]
  )

  const unlinkedAgentLabel = t('agent.session.group.unknown_agent')
  const hasUnlinkedAgent = useMemo(
    () => sessionStats?.byAgent.some((entry) => entry.agentId === null || !agentById.has(entry.agentId)) ?? false,
    [agentById, sessionStats]
  )
  const agentSources = useMemo(
    () => buildAgentSources(hasUnlinkedAgent, agentById, agentRankById, unlinkedAgentLabel, t),
    [agentById, agentRankById, hasUnlinkedAgent, t, unlinkedAgentLabel]
  )
  const additionalAgentSourceItems = useMemo(
    () =>
      agentSources
        .filter((source) => source.id !== ALL_SOURCE_ID && !agentById.has(source.id))
        .map((source) => ({
          id: source.id,
          name: source.label,
          editDisabled: true,
          pinDisabled: true
        })),
    [agentById, agentSources]
  )
  const hideSessionsOptimistically = useCallback((ids: readonly string[]) => {
    setOptimisticallyRemovedSessionIds((current) => {
      const next = new Set(current)
      for (const id of ids) next.add(id)
      return next
    })
  }, [])
  const restoreOptimisticallyHiddenSessions = useCallback((ids: readonly string[]) => {
    setOptimisticallyRemovedSessionIds((current) => {
      const next = new Set(current)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])

  const handleSessionSelect = useCallback(
    (session: SessionListItem) => {
      const title = session.name || t('common.unnamed')
      if (conversationNav.openConversationTab(session.id, title, { forceNew: true })) return

      selectActiveSession(session.id)
      onClose()
    },
    [conversationNav, onClose, selectActiveSession, t]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (isSessionPinned(id)) return

      const session = sessionById.get(id)
      if (!session) return
      const wasActive = activeRecordIdRef.current === id
      const nextSession = wasActive
        ? findAdjacentHistoryRecordAfterBulkDelete(sessionItems, [id], id, (candidate) => candidate.id)
        : undefined
      const optimisticActiveId = nextSession?.id ?? null
      hideSessionsOptimistically([id])
      if (wasActive) selectActiveSession(optimisticActiveId)

      let success = false
      try {
        success = await deleteSession(id)
      } catch (err) {
        logger.error('Failed to delete session from history records', { err, sessionId: id })
        toast.error(t('agent.session.delete.error.failed'))
      }
      if (!success) {
        restoreOptimisticallyHiddenSessions([id])
        if (wasActive && activeRecordIdRef.current === optimisticActiveId) selectActiveSession(id)
      }
    },
    [
      deleteSession,
      hideSessionsOptimistically,
      isSessionPinned,
      restoreOptimisticallyHiddenSessions,
      selectActiveSession,
      sessionById,
      sessionItems,
      t
    ]
  )

  const handleBulkDeleteSessions = useCallback(
    async (ids: string[]): Promise<readonly string[] | undefined> => {
      const activeSession = activeRecordIdRef.current ? sessionById.get(activeRecordIdRef.current) : undefined
      const wasActive = !!activeSession && ids.includes(activeSession.id)
      const optimisticNextSession = wasActive
        ? findAdjacentHistoryRecordAfterBulkDelete(sessionItems, ids, activeSession.id, (session) => session.id)
        : undefined
      const optimisticActiveId = optimisticNextSession?.id ?? null
      hideSessionsOptimistically(ids)
      if (wasActive) selectActiveSession(optimisticActiveId)

      let result: Awaited<ReturnType<typeof deleteSessions>>
      try {
        result = await deleteSessions(ids)
      } catch (err) {
        logger.error('Failed to bulk delete sessions from history records', { err, ids })
        toast.error(t('agent.session.delete.error.failed'))
        result = null
      }
      if (!result) {
        restoreOptimisticallyHiddenSessions(ids)
        if (wasActive && activeSession && activeRecordIdRef.current === optimisticActiveId) {
          selectActiveSession(activeSession.id)
        }
        return undefined
      }

      const deletedIdSet = new Set(result.deletedIds)
      const failedIds = ids.filter((id) => !deletedIdSet.has(id))
      restoreOptimisticallyHiddenSessions(failedIds)
      if (
        wasActive &&
        activeSession &&
        !deletedIdSet.has(activeSession.id) &&
        activeRecordIdRef.current === optimisticActiveId
      ) {
        selectActiveSession(activeSession.id)
      }
      return result.deletedIds
    },
    [
      deleteSessions,
      hideSessionsOptimistically,
      restoreOptimisticallyHiddenSessions,
      selectActiveSession,
      sessionById,
      sessionItems,
      t
    ]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessions.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      setOptimisticSessionNames((current) => ({ ...current, [id]: trimmedName }))
      let updatedSession: Awaited<ReturnType<typeof updateSession>>
      try {
        updatedSession = await updateSession(
          { id, name: trimmedName, isNameManuallyEdited: true },
          { showSuccessToast: false }
        )
      } catch (err) {
        logger.error('Failed to rename session from history records', { err, sessionId: id })
        toast.error(t('agent.session.update.error.failed'))
        updatedSession = undefined
      }
      if (updatedSession) {
        toast.success(t('common.saved'))
      } else {
        setOptimisticSessionNames((current) => {
          const next = { ...current }
          delete next[id]
          return next
        })
      }
    },
    [sessions, t, updateSession]
  )

  const handleToggleSessionPin = useCallback(
    async (sessionId: string) => {
      const session = sessionById.get(sessionId)
      if (!session) return false
      try {
        await togglePinnedSessionItem(session)
        return true
      } catch (err) {
        logger.error('Failed to toggle session pin from history records', { err, sessionId })
        toast.error(t('agent.session.pin.error.failed'))
        return false
      }
    },
    [sessionById, t, togglePinnedSessionItem]
  )

  const getSessionActionContext = useCallback(
    (session: AgentSessionEntity): SessionActionContext =>
      createSessionActionContext({
        isActiveInCurrentTab: false,
        onDelete: () => {
          void handleDeleteSession(session.id)
        },
        onTogglePin: () => {
          void handleToggleSessionPin(session.id)
        },
        pinned: isSessionPinned(session.id),
        sessionName: session.name ?? session.id,
        startEdit: () => undefined,
        t
      }),
    [handleDeleteSession, handleToggleSessionPin, isSessionPinned, t]
  )
  const sessionMenuPreset = useSessionMenuPreset<AgentSessionEntity>({ getActionContext: getSessionActionContext })

  const getId = useCallback((session: SessionListItem) => session.id, [])
  const onActiveRecordChange = useCallback(
    (session: SessionListItem | null) => selectActiveSession(session?.id ?? null),
    [selectActiveSession]
  )
  const rowDescriptor = useMemo(
    () => ({
      getName: (session: SessionListItem) => session.name || t('common.unnamed'),
      getCreatedAt: (session: SessionListItem) => session.createdAt,
      getSourceLabel: (session: SessionListItem) =>
        (session.agentId ? agentById.get(session.agentId)?.name : undefined) ?? t('common.unknown'),
      renderAvatar: (session: SessionListItem) => {
        const agent = session.agentId ? agentById.get(session.agentId) : undefined
        return (
          <EmojiIcon
            emoji={getAgentAvatarFromConfiguration(agent?.configuration)}
            size={20}
            fontSize={12}
            className="mr-0 text-foreground"
          />
        )
      },
      rowHeight: 32,
      getSelectLabel: (session: SessionListItem) => `${t('common.select')} ${session.name || t('common.unnamed')}`,
      getRowActions: (session: SessionListItem, openRename: (id: string, name: string) => void) => {
        const contextOverride = { startEdit: () => openRename(session.id, session.name ?? '') }
        const actions = sessionMenuPreset.getActions(session, contextOverride)
        return {
          actions,
          onAction: (action: ResolvedAction) => sessionMenuPreset.onAction(session, action, contextOverride)
        }
      },
      onOpen: handleSessionSelect,
      onTogglePin: (session: SessionListItem) => handleToggleSessionPin(session.id),
      renderRowMenu: (_session: SessionListItem, row: ReactElement, rowActions: HistoryRowActions) =>
        rowActions.actions.length ? (
          <HistoryActionContextMenu actions={rowActions.actions} className="z-50" onAction={rowActions.onAction}>
            {row}
          </HistoryActionContextMenu>
        ) : (
          row
        )
    }),
    [agentById, handleSessionSelect, handleToggleSessionPin, sessionMenuPreset, t]
  )

  const descriptor: HistoryRecordDescriptor<SessionListItem> = {
    mode: 'agent',
    getId,
    isPinned: isSessionPinned,
    onBulkDelete: handleBulkDeleteSessions,
    onActiveRecordChange,
    ...rowDescriptor,
    sources: agentSources,
    renderSourceFilter: (selectedId, onSelect) => {
      const source = selectedId ? agentSources.find((candidate) => candidate.id === selectedId) : undefined
      const agent = selectedId ? agentById.get(selectedId) : undefined
      return (
        <HistorySourceFilterField
          label={
            selectedId ? source?.label || agent?.name || t('common.unnamed') : t('history.records.filter.selectAgent')
          }
          hasValue={!!selectedId}
          clearLabel={t('common.clear')}
          onClear={() => onSelect(null)}
          icon={
            selectedId ? (
              source?.icon ? (
                source.icon
              ) : (
                <EmojiIcon
                  emoji={getAgentAvatarFromConfiguration(agent?.configuration)}
                  size={16}
                  fontSize={10}
                  className="mr-0 text-foreground"
                />
              )
            ) : undefined
          }
          selector={(trigger) => (
            <AgentSelector
              value={selectedId}
              onChange={onSelect}
              trigger={trigger}
              additionalItems={additionalAgentSourceItems}
            />
          )}
        />
      )
    },
    onRename: handleRenameSession,
    strings: {
      sourceLabel: t('common.agent'),
      searchPlaceholder: t('history.records.searchSession'),
      titleColumnLabel: t('history.records.table.session'),
      emptyTitle: t('history.records.empty.sessionsTitle'),
      emptyDescription: t('history.records.empty.sessionsDescription'),
      loadingTitle: t('history.records.loading.sessionsTitle'),
      loadingDescription: t('history.records.loading.sessionsDescription'),
      pinLabel: t('selector.common.pin'),
      unpinLabel: t('selector.common.unpin'),
      deleteLabel: t('common.delete'),
      renameDialogTitle: t('agent.session.edit.title')
    }
  }

  const controller = useHistoryRecordsController({
    descriptor,
    items: sessionItems,
    filters,
    activeRecordId
  })

  const handleEndReached = useCallback(() => {
    if (!hasMoreSessions || isSessionsLoading || isSessionsLoadingMore || sessionError) return
    loadMoreSessions()
  }, [hasMoreSessions, isSessionsLoading, isSessionsLoadingMore, loadMoreSessions, sessionError])
  const handleRetry = useCallback(() => {
    void reloadBandSessions()
  }, [reloadBandSessions])

  return (
    <HistoryRecordsContent
      descriptor={descriptor}
      controller={controller}
      error={sessionError}
      isLoading={isSessionsLoading}
      isLoadingMore={isSessionsLoadingMore}
      toolbarLeading={toolbarLeading}
      onEndReached={handleEndReached}
      onRetry={handleRetry}
    />
  )
}

export default AgentHistoryRecords
