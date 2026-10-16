import { type ReactElement, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmojiIcon } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { SessionActionContext } from '@renderer/components/chat/actions/sessionItemActions'
import { permanentDeletePopup } from '@renderer/components/chat/DeleteConversationOwnerConfirmDialog'
import { AgentSelector } from '@renderer/components/resourceCatalog/selectors'
import { dataApiService } from '@renderer/data/DataApiService'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionStreamStatuses } from '@renderer/hooks/agent/useAgentSessionStreamStatuses'
import { useUpdateSession } from '@renderer/hooks/agent/useSession'
import { createSessionActionContext, useSessionMenuPreset } from '@renderer/hooks/chat/useSessionMenuActions'
import { useResolvedCommand } from '@renderer/hooks/command'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useOptimisticResourceName } from '@renderer/hooks/useOptimisticResourceName'
import {
  restoreRecycleBinItem,
  restoreRecycleBinItems,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { type SessionListItem, sortSessionsForDisplayGroups } from '@renderer/utils/chat/sessionListHelpers'
import { isElementSuppressed } from '@renderer/utils/commandFocus'
import { getErrorMessage } from '@renderer/utils/error'
import { matchesSearchText } from '@renderer/utils/pinyin'
import { pickNeighbourAfterRemoval } from '@renderer/utils/resourceEntity'
import { classifyTurn } from '@shared/ai/transport'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { isAgentSessionNotFoundError } from '@shared/ipc/errors/ai'

import { HistoryRecordsContent } from './components/HistoryRecordsContent'
import { HistorySourceFilterField } from './components/HistorySourceFilter'
import { HistoryActionContextMenu } from './components/HistoryTableParts'
import type {
  HistoryBulkDeleteResult,
  HistoryRecordDescriptor,
  HistoryRowActions,
  HistoryRowState
} from './historyRecordsDescriptor'
import {
  ALL_SOURCE_ID,
  buildAgentSources,
  buildAgentStatusItems,
  findAdjacentHistoryRecordAfterBulkDelete,
  getAgentHistoryStatus,
  getSessionAgentSourceId
} from './historyRecordsHelpers'
import { useHistoryRecordsController } from './useHistoryRecordsController'

const logger = loggerService.withContext('AgentHistoryRecords')

function removalGuardIsOpen(): boolean {
  const nodes = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (node.getAttribute('data-state') === 'closed' || isElementSuppressed(node)) continue
    return true
  }
  return false
}

function AgentHistoryRowState({
  sessionId,
  children
}: {
  sessionId: string
  children: (state: HistoryRowState) => ReactElement
}) {
  useSharedCacheValue(`topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const)
  return children({ isRenaming: false })
}

function isAgentHistorySessionBusy(sessionId: string): boolean {
  const entry = cacheService.getShared(`topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const)
  const flags = classifyTurn(entry?.status)
  return flags.isStreamLive || flags.isAwaitingApproval || (entry?.awaitingApprovalAnchors?.length ?? 0) > 0
}

function survivingHistoryNeighbor<T extends { id: string }>(
  orderedBeforeDelete: readonly T[],
  refreshed: readonly T[],
  deletedId: string,
  neighborBeforeDelete: T | undefined
): T | undefined {
  const remaining = refreshed.filter((item) => item.id !== deletedId)
  if (neighborBeforeDelete) {
    const stillThere = remaining.find((item) => item.id === neighborBeforeDelete.id)
    if (stillThere) return stillThere
  }
  if (remaining.length === 0) return undefined

  const remainingIds = new Set(remaining.map((item) => item.id))
  const fallback = orderedBeforeDelete.find((item) => item.id !== deletedId && remainingIds.has(item.id))
  return fallback ? remaining.find((item) => item.id === fallback.id) : remaining[0]
}

interface AgentHistoryRecordsProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (sessionId: string) => void
  onActiveRecordChange?: (sessionId: string | null) => void
  /**
   * Runs before the irreversible confirm when the active session is the delete target.
   * `transition` opens the confirm dialog. Callers may defer it for an unsaved-file guard.
   */
  requestRecordRemoval?: (nextSessionId: string | null, transition: () => void) => void
  toolbarLeading?: ReactNode
}

const AgentHistoryRecords = ({
  activeRecordId,
  onClose,
  onRecordSelect,
  onActiveRecordChange: onActiveSessionChange,
  requestRecordRemoval,
  toolbarLeading
}: AgentHistoryRecordsProps) => {
  const { t } = useTranslation()
  const [groupNow] = useState(() => new Date())
  const conversationNav = useConversationNavigation('agents')
  const { shortcutLabel: permanentDeleteShortcut } = useResolvedCommand('resource.delete_permanently')

  const {
    sessions,
    pinIdBySessionId,
    isLoadingAll: isSessionsLoading,
    deleteSession,
    deleteSessionWithOutcome,
    reload,
    restoreSession,
    togglePin
  } = useAgentSessionsSource()
  const { agents } = useAgents()
  const { updateSession } = useUpdateSession()
  const { items: optimisticSessions, rename: renameSessionOptimistically } = useOptimisticResourceName(sessions)

  const isSessionPinned = useCallback((sessionId: string) => pinIdBySessionId.has(sessionId), [pinIdBySessionId])
  const sessionItems = useMemo<SessionListItem[]>(
    () => optimisticSessions.map((session) => ({ ...session, pinned: isSessionPinned(session.id) })),
    [isSessionPinned, optimisticSessions]
  )
  const sessionItemsRef = useRef(sessionItems)
  const pinIdBySessionIdRef = useRef(pinIdBySessionId)
  const activeRecordIdRef = useRef(activeRecordId)
  const permanentDeleteLockRef = useRef(false)
  const deferredRemovalIdRef = useRef<string | null>(null)
  sessionItemsRef.current = sessionItems
  pinIdBySessionIdRef.current = pinIdBySessionId
  activeRecordIdRef.current = activeRecordId
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const agentRankById = useMemo(() => new Map(agents.map((agent, index) => [agent.id, index])), [agents])

  const timeSortedSessions = useMemo(
    () => sortSessionsForDisplayGroups(sessionItems, { mode: 'time', now: groupNow }),
    [groupNow, sessionItems]
  )
  const timeSortedSessionsRef = useRef(timeSortedSessions)
  timeSortedSessionsRef.current = timeSortedSessions
  const agentSortedSessions = useMemo(
    () => sortSessionsForDisplayGroups(sessionItems, { agentRankById, mode: 'agent', now: groupNow }),
    [agentRankById, groupNow, sessionItems]
  )

  const sessionIds = useMemo(() => sessionItems.map((session) => session.id), [sessionItems])
  const streamStatusBySessionId = useAgentSessionStreamStatuses(sessionIds)
  const streamStatusBySessionIdRef = useRef(streamStatusBySessionId)
  streamStatusBySessionIdRef.current = streamStatusBySessionId

  const unknownAgentLabel = t('agent.session.group.unknown_agent')
  const statusItems = useMemo(() => buildAgentStatusItems(t), [t])
  const agentSources = useMemo(
    () => buildAgentSources(sessionItems, agentById, agentRankById, unknownAgentLabel, t),
    [agentById, agentRankById, sessionItems, t, unknownAgentLabel]
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
      if (!success) return

      if (activeRecordId === id) {
        const nextSession = findAdjacentHistoryRecordAfterBulkDelete(
          timeSortedSessions,
          [id],
          id,
          (session) => session.id
        )
        onActiveSessionChange?.(nextSession?.id ?? null)
      }

      const session = sessionItems.find((candidate) => candidate.id === id)
      showRecycleBinUndo({
        itemName: session?.name || t('common.unnamed'),
        onUndo: () =>
          restoreRecycleBinItem({
            id,
            restore: restoreSession,
            getActive: (sessionId) => dataApiService.get(`/agent-sessions/${sessionId}`),
            isNotFound: isAgentSessionNotFoundError,
            refresh: reload
          })
      })
    },
    [
      activeRecordId,
      deleteSession,
      isSessionPinned,
      onActiveSessionChange,
      reload,
      restoreSession,
      sessionItems,
      t,
      timeSortedSessions
    ]
  )

  const handlePermanentDeleteSession = useCallback(
    (id: string) => {
      const wasActiveAtStart = activeRecordIdRef.current === id
      const orderedBeforeDelete = timeSortedSessionsRef.current
      const neighborBeforeDelete = pickNeighbourAfterRemoval(orderedBeforeDelete, id)
      const nextSessionId = neighborBeforeDelete?.id ?? null

      const startConfirmation = (): Promise<void> => {
        deferredRemovalIdRef.current = null
        if (permanentDeleteLockRef.current) return Promise.resolve()
        permanentDeleteLockRef.current = true
        const current = sessionItemsRef.current.find((session) => session.id === id)
        return permanentDeletePopup
          .show({
            kind: 'conversation',
            name: current?.name?.trim() || t('common.unnamed'),
            action: async () => {
              if (pinIdBySessionIdRef.current.has(id)) {
                throw new Error(t('recycle_bin.delete.pinned'))
              }
              if (isAgentHistorySessionBusy(id) || streamStatusBySessionIdRef.current.get(id)?.isPending) {
                throw new Error(t('recycle_bin.delete.busy'))
              }

              const outcome = await deleteSessionWithOutcome(id, { permanent: true, showFeedback: false })
              if (outcome.status !== 'succeeded') {
                await reload().catch((refreshError) => {
                  logger.warn('Failed to refresh sessions after permanent delete failed', refreshError as Error, {
                    sessionId: id
                  })
                })
                throw new Error(
                  outcome.status === 'failed'
                    ? outcome.error || t('agent.session.delete.error.failed')
                    : t('recycle_bin.delete.stale')
                )
              }

              const activeId = activeRecordIdRef.current
              const clearedDuringDelete = activeId == null && wasActiveAtStart
              if (activeId !== id && !clearedDuringDelete) return

              const nextSession = survivingHistoryNeighbor(
                orderedBeforeDelete,
                timeSortedSessionsRef.current,
                id,
                neighborBeforeDelete
              )
              onActiveSessionChange?.(nextSession?.id ?? null)
            }
          })
          .then(() => undefined)
          .finally(() => {
            permanentDeleteLockRef.current = false
          })
      }

      if (!wasActiveAtStart || !requestRecordRemoval) return startConfirmation()

      if (deferredRemovalIdRef.current === id && removalGuardIsOpen()) return Promise.resolve()
      deferredRemovalIdRef.current = null

      let started = false
      let pending = Promise.resolve()
      requestRecordRemoval(nextSessionId, () => {
        started = true
        pending = startConfirmation().catch((error) => {
          logger.error('Failed to permanently delete session from history', error as Error, { sessionId: id })
          toast.error(getErrorMessage(error))
        })
      })
      if (started) return pending

      deferredRemovalIdRef.current = id
      return Promise.resolve()
    },
    [deleteSessionWithOutcome, onActiveSessionChange, reload, requestRecordRemoval, t]
  )

  const handleBulkDeleteSessions = useCallback(
    async (ids: string[]): Promise<HistoryBulkDeleteResult> => {
      const outcomes = await Promise.allSettled(ids.map((id) => deleteSessionWithOutcome(id, { showFeedback: false })))
      const staleIds: string[] = []
      const result = outcomes.reduce<HistoryBulkDeleteResult>(
        (summary, outcome, index) => {
          const id = ids[index]
          if (outcome.status === 'rejected') {
            summary.failed.push({ id, error: getErrorMessage(outcome.reason) })
          } else if (outcome.value.status === 'succeeded') {
            summary.succeeded.push(id)
          } else {
            if (outcome.value.status === 'stale') staleIds.push(id)
            summary.failed.push({
              id,
              error: outcome.value.status === 'failed' ? outcome.value.error : t('recycle_bin.already_moved')
            })
          }
          return summary
        },
        { succeeded: [], failed: [] }
      )

      if (result.succeeded.length === 0) {
        if (staleIds.length === ids.length) toast.info(t('recycle_bin.already_moved'))
        else toast.error(t('recycle_bin.move_failed'))
      }

      if (result.succeeded.length > 0) {
        const deletedIds = [...result.succeeded]
        showRecycleBinBatchUndo({
          itemCount: deletedIds.length,
          onUndo: () =>
            restoreRecycleBinItems({
              ids: deletedIds,
              restore: restoreSession,
              getActive: (sessionId) => dataApiService.get(`/agent-sessions/${sessionId}`),
              isNotFound: isAgentSessionNotFoundError,
              refresh: reload
            })
        })
      }

      return result
    },
    [deleteSessionWithOutcome, reload, restoreSession, t]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessionItems.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      const renamed = await renameSessionOptimistically(session, trimmedName, async () =>
        Boolean(await updateSession({ id, name: trimmedName, isNameManuallyEdited: true }, { showSuccessToast: false }))
      )
      if (renamed) {
        toast.success(t('common.saved'))
      }
    },
    [renameSessionOptimistically, sessionItems, t, updateSession]
  )

  const handleToggleSessionPin = useCallback((sessionId: string) => togglePin(sessionId), [togglePin])

  const getSessionActionContext = useCallback(
    (session: AgentSessionEntity): SessionActionContext =>
      createSessionActionContext({
        isActiveInCurrentTab: false,
        isBusy: isAgentHistorySessionBusy(session.id),
        onDelete: () => {
          void handleDeleteSession(session.id)
        },
        onDeletePermanently: () => handlePermanentDeleteSession(session.id),
        permanentDeleteShortcut,
        onTogglePin: () => {
          void handleToggleSessionPin(session.id)
        },
        pinned: isSessionPinned(session.id),
        sessionName: session.name ?? session.id,
        startEdit: () => undefined,
        t
      }),
    [
      handleDeleteSession,
      handlePermanentDeleteSession,
      handleToggleSessionPin,
      isSessionPinned,
      permanentDeleteShortcut,
      t
    ]
  )
  const sessionMenuPreset = useSessionMenuPreset<AgentSessionEntity>({ getActionContext: getSessionActionContext })

  const getId = useCallback((session: SessionListItem) => session.id, [])
  const getSourceId = useCallback(
    (session: SessionListItem) => getSessionAgentSourceId(session, agentById),
    [agentById]
  )
  const statusOf = useCallback(
    (session: SessionListItem) => getAgentHistoryStatus(streamStatusBySessionId.get(session.id)),
    [streamStatusBySessionId]
  )
  const matchesSearch = useCallback(
    (session: SessionListItem, keywords: string) => {
      const agent = session.agentId ? agentById.get(session.agentId) : undefined
      return (
        [session.name, agent?.name].some((value) => value && matchesSearchText(value, keywords)) ||
        Boolean(session.description?.toLowerCase().includes(keywords))
      )
    },
    [agentById]
  )
  const onActiveRecordChange = useCallback(
    (session: SessionListItem | null) => onActiveSessionChange?.(session?.id ?? null),
    [onActiveSessionChange]
  )
  const rowDescriptor = useMemo(
    () => ({
      getName: (session: SessionListItem) => session.name || t('common.unnamed'),
      getUpdatedAt: (session: SessionListItem) => session.lastActivityAt,
      getSourceLabel: (session: SessionListItem) =>
        (session.agentId ? agentById.get(session.agentId)?.name : undefined) ?? unknownAgentLabel,
      renderAvatar: (session: SessionListItem) => {
        const agent = session.agentId ? agentById.get(session.agentId) : undefined
        return (
          <EmojiIcon
            emoji={getAgentAvatarFromConfiguration(agent?.configuration)}
            size={20}
            className="text-foreground"
          />
        )
      },
      rowHeight: 32,
      getSelectLabel: (session: SessionListItem) => `${t('common.select')} ${session.name || t('common.unnamed')}`,
      renderRowState: (session: SessionListItem, render: (state: HistoryRowState) => ReactElement) => (
        <AgentHistoryRowState sessionId={session.id}>{render}</AgentHistoryRowState>
      ),
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
    [agentById, handleSessionSelect, handleToggleSessionPin, sessionMenuPreset, t, unknownAgentLabel]
  )

  const descriptor: HistoryRecordDescriptor<SessionListItem> = {
    mode: 'agent',
    getId,
    isPinned: isSessionPinned,
    getSourceId,
    statusOf,
    matchesSearch,
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
                  className="text-foreground"
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
      deleteLabel: t('common.archive'),
      renameDialogTitle: t('agent.session.edit.title')
    }
  }

  const controller = useHistoryRecordsController({
    descriptor,
    timeSorted: timeSortedSessions,
    sourceSorted: agentSortedSessions,
    activeRecordId
  })

  return (
    <HistoryRecordsContent
      descriptor={descriptor}
      controller={controller}
      isLoading={isSessionsLoading}
      toolbarLeading={toolbarLeading}
    />
  )
}

export default AgentHistoryRecords
