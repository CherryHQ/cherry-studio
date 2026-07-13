import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { SessionActionContext } from '@renderer/components/chat/actions/sessionItemActions'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { AgentSelector } from '@renderer/components/resourceCatalog/selectors'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionHistoryStatusIds } from '@renderer/hooks/agent/useAgentSessionStreamStatuses'
import {
  useAgentSessionsByIds,
  useAgentSessionStats,
  useSessions,
  useUpdateSession
} from '@renderer/hooks/agent/useSession'
import { createSessionActionContext, useSessionMenuPreset } from '@renderer/hooks/chat/useSessionMenuActions'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useDebouncedValue } from '@renderer/hooks/useDebouncedValue'
import { toast } from '@renderer/services/toast'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { SessionListItem } from '@renderer/utils/chat/sessionListHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HistoryRecordsContent } from './components/HistoryRecordsContent'
import { HistorySourceFilterField } from './components/HistorySourceFilter'
import { HistoryActionContextMenu } from './components/HistoryTableParts'
import type { HistoryRecordDescriptor, HistoryRowActions } from './historyRecordsDescriptor'
import {
  ALL_SOURCE_ID,
  buildAgentSources,
  buildAgentStatusItems,
  findAdjacentHistoryRecordAfterBulkDelete,
  toServerOwnerScope
} from './historyRecordsHelpers'
import { useHistoryRecordsController, useHistoryRecordsFilters } from './useHistoryRecordsController'

const SEARCH_DEBOUNCE_MS = 300
const HISTORY_PAGE_SIZE = 50

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
  const { activeIds, failedIds } = useAgentSessionHistoryStatusIds()
  const runtimeStatusIds = useMemo(() => {
    if (filters.selectedStatus === 'running') return [...activeIds]
    if (filters.selectedStatus === 'failed') return [...failedIds]
    return []
  }, [activeIds, failedIds, filters.selectedStatus])
  const usesRuntimeStatusIds = filters.selectedStatus === 'running' || filters.selectedStatus === 'failed'
  const ownerScope = toServerOwnerScope(filters.selectedSourceId)
  const historySortBy = 'updatedAt' as const

  const {
    sessions: pinnedSourceSessions,
    pages: pinnedSessionPages,
    error: pinnedSessionsError,
    hasMore: hasMorePinnedSessions,
    isLoading: isPinnedSessionsLoading,
    isLoadingMore: isPinnedSessionsLoadingMore,
    loadMore: loadMorePinnedSessions,
    reload: reloadPinnedSessions
  } = useSessions(ownerScope, {
    enabled: !usesRuntimeStatusIds,
    keepPreviousData: false,
    pageSize: HISTORY_PAGE_SIZE,
    q: debouncedSearch,
    searchScope: 'full',
    sortBy: historySortBy,
    pinned: true
  })
  const {
    sessions: unpinnedSourceSessions,
    pages: unpinnedSessionPages,
    deleteSession,
    deleteSessions,
    error: unpinnedSessionsError,
    hasMore: hasMoreUnpinnedSessions,
    isLoading: isUnpinnedSessionsLoading,
    isLoadingMore: isUnpinnedSessionsLoadingMore,
    loadMore: loadMoreUnpinnedSessions,
    reload: reloadUnpinnedSessions,
    togglePin
  } = useSessions(ownerScope, {
    enabled: !usesRuntimeStatusIds,
    keepPreviousData: false,
    pageSize: HISTORY_PAGE_SIZE,
    q: debouncedSearch,
    searchScope: 'full',
    sortBy: historySortBy,
    pinned: false
  })
  const {
    sessions: runtimePinnedSessions,
    error: runtimePinnedSessionsError,
    isLoading: isRuntimePinnedSessionsLoading,
    refetch: refetchRuntimePinnedSessions
  } = useAgentSessionsByIds(runtimeStatusIds, {
    agentId: ownerScope,
    enabled: usesRuntimeStatusIds,
    pinned: true,
    q: debouncedSearch,
    searchScope: 'full'
  })
  const {
    sessions: runtimeUnpinnedSessions,
    error: runtimeUnpinnedSessionsError,
    isLoading: isRuntimeUnpinnedSessionsLoading,
    refetch: refetchRuntimeUnpinnedSessions
  } = useAgentSessionsByIds(runtimeStatusIds, {
    agentId: ownerScope,
    enabled: usesRuntimeStatusIds,
    pinned: false,
    q: debouncedSearch,
    searchScope: 'full'
  })
  const { agents } = useAgents()
  const { stats: sessionStats } = useAgentSessionStats()
  const { updateSession } = useUpdateSession()

  const pinnedSessions = useMemo(
    () => pinnedSourceSessions.filter((session) => session.pinned === true),
    [pinnedSourceSessions]
  )
  const unpinnedSessions = useMemo(
    () => unpinnedSourceSessions.filter((session) => session.pinned !== true),
    [unpinnedSourceSessions]
  )
  const isPinnedBandComplete = !isPinnedSessionsLoading && !pinnedSessionsError && !hasMorePinnedSessions
  const baseSessions = useMemo(
    () => [...pinnedSessions, ...(isPinnedBandComplete ? unpinnedSessions : [])],
    [isPinnedBandComplete, pinnedSessions, unpinnedSessions]
  )
  const orderedRuntimeSessions = useMemo(
    () => [
      ...runtimePinnedSessions.filter((session) => session.pinned === true),
      ...runtimeUnpinnedSessions.filter((session) => session.pinned !== true)
    ],
    [runtimePinnedSessions, runtimeUnpinnedSessions]
  )
  const sessions = useMemo(() => {
    const queried = usesRuntimeStatusIds ? orderedRuntimeSessions : baseSessions
    if (filters.selectedStatus !== 'completed') return queried
    return queried.filter((session) => !activeIds.has(session.id) && !failedIds.has(session.id))
  }, [activeIds, baseSessions, failedIds, filters.selectedStatus, orderedRuntimeSessions, usesRuntimeStatusIds])
  const sessionError = usesRuntimeStatusIds
    ? (runtimePinnedSessionsError ?? runtimeUnpinnedSessionsError)
    : (pinnedSessionsError ?? (isPinnedBandComplete ? unpinnedSessionsError : undefined))
  const isSessionsLoading = usesRuntimeStatusIds
    ? isRuntimePinnedSessionsLoading || isRuntimeUnpinnedSessionsLoading
    : isPinnedSessionsLoading || (isPinnedBandComplete && isUnpinnedSessionsLoading)
  const isSessionsLoadingMore =
    !usesRuntimeStatusIds && (isPinnedSessionsLoadingMore || (isPinnedBandComplete && isUnpinnedSessionsLoadingMore))
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const isSessionPinned = useCallback((sessionId: string) => sessionById.get(sessionId)?.pinned === true, [sessionById])
  const sessionItems = useMemo<SessionListItem[]>(() => [...sessions], [sessions])
  const hasMoreSessions =
    !usesRuntimeStatusIds && (hasMorePinnedSessions || (isPinnedBandComplete && hasMoreUnpinnedSessions))
  const loadMoreSessions = useCallback(() => {
    if (usesRuntimeStatusIds || isSessionsLoading || isSessionsLoadingMore || sessionError) return
    if (hasMorePinnedSessions) {
      loadMorePinnedSessions()
    } else if (isPinnedBandComplete && hasMoreUnpinnedSessions) {
      loadMoreUnpinnedSessions()
    }
  }, [
    hasMorePinnedSessions,
    hasMoreUnpinnedSessions,
    isPinnedBandComplete,
    isSessionsLoading,
    isSessionsLoadingMore,
    loadMorePinnedSessions,
    loadMoreUnpinnedSessions,
    sessionError,
    usesRuntimeStatusIds
  ])

  const [completedTargetCount, setCompletedTargetCount] = useState(HISTORY_PAGE_SIZE)
  const completedOverfetchAttemptRef = useRef<string | null>(null)
  useEffect(() => {
    setCompletedTargetCount(HISTORY_PAGE_SIZE)
    completedOverfetchAttemptRef.current = null
  }, [debouncedSearch, filters.selectedSourceId, filters.selectedStatus])

  const basePageCount = (pinnedSessionPages?.length ?? 0) + (unpinnedSessionPages?.length ?? 0)
  useEffect(() => {
    if (
      usesRuntimeStatusIds ||
      filters.selectedStatus !== 'completed' ||
      sessionItems.length >= completedTargetCount ||
      !hasMoreSessions ||
      isSessionsLoading ||
      isSessionsLoadingMore ||
      sessionError
    ) {
      return
    }

    const attemptKey = `${completedTargetCount}:${basePageCount}`
    if (completedOverfetchAttemptRef.current === attemptKey) return
    completedOverfetchAttemptRef.current = attemptKey
    loadMoreSessions()
  }, [
    basePageCount,
    completedTargetCount,
    filters.selectedStatus,
    hasMoreSessions,
    isSessionsLoading,
    isSessionsLoadingMore,
    loadMoreSessions,
    sessionError,
    sessionItems.length,
    usesRuntimeStatusIds
  ])
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const agentRankById = useMemo(() => new Map(agents.map((agent, index) => [agent.id, index])), [agents])

  const unknownAgentLabel = t('agent.session.group.unknown_agent')
  const statusItems = useMemo(() => buildAgentStatusItems(t), [t])
  const hasUnknownAgent = useMemo(
    () => sessionStats?.byAgent.some((entry) => entry.agentId === null || !agentById.has(entry.agentId)) ?? false,
    [agentById, sessionStats]
  )
  const agentSources = useMemo(
    () => buildAgentSources(hasUnknownAgent, agentById, agentRankById, unknownAgentLabel, t),
    [agentById, agentRankById, hasUnknownAgent, t, unknownAgentLabel]
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

  const handleSessionSelect = useCallback(
    (session: SessionListItem) => {
      const title = session.name || t('common.unnamed')
      if (conversationNav.openConversationTab(session.id, title, { forceNew: true })) return

      onRecordSelect?.(session.id)
      onClose()
    },
    [conversationNav, onClose, onRecordSelect, t]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (isSessionPinned(id)) return

      const success = await deleteSession(id)
      if (success && activeRecordId === id) {
        const nextSession = findAdjacentHistoryRecordAfterBulkDelete(sessionItems, [id], id, (session) => session.id)
        onRecordSelect?.(nextSession?.id ?? null)
      }
    },
    [activeRecordId, deleteSession, isSessionPinned, onRecordSelect, sessionItems]
  )

  const handleBulkDeleteSessions = useCallback(
    async (ids: string[]): Promise<readonly string[] | undefined> => {
      const result = await deleteSessions(ids)
      return result ? result.deletedIds : undefined
    },
    [deleteSessions]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessions.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      const updatedSession = await updateSession(
        { id, name: trimmedName, isNameManuallyEdited: true },
        { showSuccessToast: false }
      )
      if (updatedSession) {
        toast.success(t('common.saved'))
      }
    },
    [sessions, t, updateSession]
  )

  const handleToggleSessionPin = useCallback(
    (sessionId: string) => togglePin(sessionId, sessionById.get(sessionId)?.pinId),
    [sessionById, togglePin]
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
    (session: SessionListItem | null) => onRecordSelect?.(session?.id ?? null),
    [onRecordSelect]
  )
  const rowDescriptor = useMemo(
    () => ({
      getName: (session: SessionListItem) => session.name || t('common.unnamed'),
      getUpdatedAt: (session: SessionListItem) => session.updatedAt,
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
    statusOptions: statusItems,
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
    if (usesRuntimeStatusIds || !hasMoreSessions || isSessionsLoading || isSessionsLoadingMore || sessionError) return
    if (filters.selectedStatus === 'completed') {
      if (sessionItems.length < completedTargetCount) return
      setCompletedTargetCount((current) => Math.max(current, sessionItems.length) + HISTORY_PAGE_SIZE)
      return
    }
    loadMoreSessions()
  }, [
    completedTargetCount,
    filters.selectedStatus,
    hasMoreSessions,
    isSessionsLoading,
    isSessionsLoadingMore,
    loadMoreSessions,
    sessionError,
    sessionItems.length,
    usesRuntimeStatusIds
  ])
  const handleRetry = useCallback(() => {
    if (usesRuntimeStatusIds) {
      void Promise.all([refetchRuntimePinnedSessions(), refetchRuntimeUnpinnedSessions()])
      return
    }
    void Promise.all([reloadPinnedSessions(), reloadUnpinnedSessions()])
  }, [
    refetchRuntimePinnedSessions,
    refetchRuntimeUnpinnedSessions,
    reloadPinnedSessions,
    reloadUnpinnedSessions,
    usesRuntimeStatusIds
  ])

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
