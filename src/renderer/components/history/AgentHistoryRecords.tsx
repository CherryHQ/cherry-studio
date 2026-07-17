import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { SessionActionContext } from '@renderer/components/chat/actions/sessionItemActions'
import { EntityAvatarIcon } from '@renderer/components/EntityAvatarIcon'
import { AgentSelector } from '@renderer/components/resourceCatalog/selectors'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionStreamStatuses } from '@renderer/hooks/agent/useAgentSessionStreamStatuses'
import { useSessions, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { createSessionActionContext, useSessionMenuPreset } from '@renderer/hooks/chat/useSessionMenuActions'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { toast } from '@renderer/services/toast'
import { type SessionListItem, sortSessionsForDisplayGroups } from '@renderer/utils/chat/sessionListHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { type ReactElement, type ReactNode, useCallback, useMemo, useState } from 'react'
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
  getAgentHistoryStatus,
  getSessionAgentSourceId
} from './historyRecordsHelpers'
import { useHistoryRecordsController } from './useHistoryRecordsController'

interface AgentHistoryRecordsProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (sessionId: string | null) => void
  toolbarLeading?: ReactNode
}

const AgentHistoryRecords = ({ activeRecordId, onClose, onRecordSelect, toolbarLeading }: AgentHistoryRecordsProps) => {
  const { t } = useTranslation()
  const [groupNow] = useState(() => new Date())
  const conversationNav = useConversationNavigation('agents')

  const {
    sessions,
    pinIdBySessionId,
    isLoading: isSessionsLoading,
    deleteSession,
    deleteSessions,
    togglePin
  } = useSessions(undefined, { loadAll: true, pageSize: 50 })
  const { agents } = useAgents()
  const { updateSession } = useUpdateSession()

  const isSessionPinned = useCallback((sessionId: string) => pinIdBySessionId.has(sessionId), [pinIdBySessionId])
  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: isSessionPinned(session.id) })),
    [isSessionPinned, sessions]
  )
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const agentRankById = useMemo(() => new Map(agents.map((agent, index) => [agent.id, index])), [agents])

  const timeSortedSessions = useMemo(
    () => sortSessionsForDisplayGroups(sessionItems, { mode: 'time', now: groupNow }),
    [groupNow, sessionItems]
  )
  const agentSortedSessions = useMemo(
    () => sortSessionsForDisplayGroups(sessionItems, { agentRankById, mode: 'agent', now: groupNow }),
    [agentRankById, groupNow, sessionItems]
  )

  const sessionIds = useMemo(() => sessionItems.map((session) => session.id), [sessionItems])
  const streamStatusBySessionId = useAgentSessionStreamStatuses(sessionIds)

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
      if (success && activeRecordId === id) {
        const nextSession = findAdjacentHistoryRecordAfterBulkDelete(
          timeSortedSessions,
          [id],
          id,
          (session) => session.id
        )
        onRecordSelect?.(nextSession?.id ?? null)
      }
    },
    [activeRecordId, deleteSession, isSessionPinned, onRecordSelect, timeSortedSessions]
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

  const handleToggleSessionPin = useCallback((sessionId: string) => togglePin(sessionId), [togglePin])

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
      return [session.name, session.description, agent?.name].some((value) => value?.toLowerCase().includes(keywords))
    },
    [agentById]
  )
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
        return agent ? (
          <EntityAvatarIcon avatar={agent.avatar} size={20} fontSize={12} className="mr-0 text-foreground" />
        ) : null
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
              ) : agent ? (
                <EntityAvatarIcon avatar={agent.avatar} size={16} fontSize={10} className="mr-0 text-foreground" />
              ) : undefined
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
