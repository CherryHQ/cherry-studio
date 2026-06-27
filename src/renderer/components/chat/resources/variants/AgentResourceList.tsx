import { loggerService } from '@logger'
import { useOptionalShellActions } from '@renderer/components/chat/panes/Shell'
import {
  ResourceEntityRail,
  type ResourceEntityRailItem
} from '@renderer/components/chat/resources/variants/ResourceEntityRail'
import {
  type ResourceEntityRailReorderAnchor,
  useResourceEntityRail
} from '@renderer/components/chat/resources/variants/useResourceEntityRail'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ResourceEditDialogHost, type ResourceEditDialogTarget } from '@renderer/components/resource/dialogs'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { usePins } from '@renderer/hooks/usePins'
import {
  type AgentGroupAction,
  type AgentGroupActionContext,
  executeAgentGroupAction,
  resolveAgentGroupActions
} from '@renderer/pages/agents/components/agentGroupActions'
import {
  type SessionListItem,
  sortSessionsForDisplayGroups
} from '@renderer/pages/agents/components/sessionListHelpers'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AgentResourceList')

type AgentResourceListProps = {
  activeAgentId?: string | null
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSelectSession: (sessionId: string, session: AgentSessionEntity) => void
  onStartDraftAgent: (agentId: string) => void | Promise<void>
  onStartMissingAgentDraft?: () => void | Promise<void>
}

export function AgentResourceList({
  activeAgentId,
  onAddAgent,
  onOpenHistoryRecords,
  onSelectSession,
  onStartDraftAgent,
  onStartMissingAgentDraft
}: AgentResourceListProps) {
  const { t } = useTranslation()
  const closeRightPane = useOptionalShellActions()?.close
  const { agents, isLoading: isAgentsLoading, error: agentsError, refetch: refetchAgents } = useAgents()
  const {
    sessions,
    pinIdBySessionId,
    isLoading,
    isLoadingAll,
    isFullyLoaded,
    isPinsLoading,
    error: sessionsError,
    reload
  } = useAgentSessionsSource()
  const {
    isLoading: isAgentPinsLoading,
    isRefreshing: isAgentPinsRefreshing,
    isMutating: isAgentPinsMutating,
    pinnedIds: agentPinnedIds,
    togglePin: toggleAgentPin
  } = usePins('agent')
  const { trigger: deleteAgentSessions } = useMutation('DELETE', '/agents/:agentId/sessions', {
    refresh: ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating
  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: pinIdBySessionId.has(session.id) })),
    [pinIdBySessionId, sessions]
  )

  const entities = useMemo<ResourceEntityRailItem[]>(
    () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        orderKey: agent.orderKey,
        pinned: agentPinnedIdSet.has(agent.id),
        icon: (
          <EmojiIcon
            emoji={getAgentAvatarFromConfiguration(agent.configuration)}
            size={24}
            fontSize={14}
            className="mr-0"
          />
        )
      })),
    [agents, agentPinnedIdSet]
  )

  const sortSessionsForEntity = useCallback(
    (entitySessions: SessionListItem[]) =>
      sortSessionsForDisplayGroups(entitySessions, { mode: 'time', now: new Date() }),
    []
  )
  const handlePickSession = useCallback(
    (session: SessionListItem) => onSelectSession(session.id, session),
    [onSelectSession]
  )
  const reorderAgentEntity = useCallback(
    async (agentId: string, anchor: ResourceEntityRailReorderAnchor) => {
      await reorderAgent({ params: { id: agentId }, body: anchor })
    },
    [reorderAgent]
  )
  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder agent old-view rail', { error })
      window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
    },
    [t]
  )

  const { items, listStatus, selectedId, handleSelect, handleReorder } = useResourceEntityRail({
    entities,
    resources: sessionItems,
    getResourceParentId: (session) => session.agentId,
    activeEntityId: activeAgentId,
    isLoading: isAgentsLoading || isLoading || isLoadingAll || !isFullyLoaded || isPinsLoading,
    isError: !!(agentsError || sessionsError),
    sortResourcesForEntity: sortSessionsForEntity,
    onPickResource: handlePickSession,
    onStartDraft: onStartDraftAgent,
    reorder: reorderAgentEntity,
    refetchEntities: refetchAgents,
    onReorderError: handleReorderError
  })

  const openAgentEditor = useCallback((agentId: string) => {
    setEditDialogTarget({ kind: 'agent', id: agentId })
  }, [])

  const handleToggleAgentPin = useCallback(
    async (agentId: string) => {
      if (isAgentPinActionDisabled) return

      try {
        await toggleAgentPin(agentId)
        await refetchAgents()
      } catch (err) {
        logger.error('Failed to toggle agent pin from old-view rail', { agentId, err })
        window.toast.error(t('common.error'))
      }
    },
    [isAgentPinActionDisabled, refetchAgents, t, toggleAgentPin]
  )

  const handleDeleteAgentSessions = useCallback(
    async (agentId: string) => {
      if (deletingAgentId) return

      const targetSessionIds = sessionItems
        .filter((session) => session.agentId === agentId)
        .map((session) => session.id)
      if (targetSessionIds.length === 0) return

      setDeletingAgentId(agentId)
      try {
        const confirmed = await window.modal.confirm({
          title: t('agent.session.agent.delete.title'),
          content: t('agent.session.agent.delete.content'),
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        await deleteAgentSessions({ params: { agentId } })
        if (activeAgentId === agentId) {
          closeRightPane?.()
          await onStartDraftAgent(agentId)
        }

        await reload()
        window.toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete agent sessions from old-view rail', { agentId, err, targetSessionIds })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.agent.delete.error.failed')))
      } finally {
        setDeletingAgentId(null)
      }
    },
    [activeAgentId, closeRightPane, deleteAgentSessions, deletingAgentId, onStartDraftAgent, reload, sessionItems, t]
  )

  const buildActionContext = useCallback(
    (agentId: string): AgentGroupActionContext => ({
      agentId,
      deleteSessionsDisabled: !!deletingAgentId || !sessionItems.some((session) => session.agentId === agentId),
      onDeleteSessions: handleDeleteAgentSessions,
      onEdit: openAgentEditor,
      onTogglePin: handleToggleAgentPin,
      pinDisabled: isAgentPinActionDisabled,
      pinned: agentPinnedIdSet.has(agentId),
      t
    }),
    [
      agentPinnedIdSet,
      deletingAgentId,
      handleDeleteAgentSessions,
      handleToggleAgentPin,
      isAgentPinActionDisabled,
      openAgentEditor,
      sessionItems,
      t
    ]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem) => resolveAgentGroupActions(buildActionContext(item.id)),
    [buildActionContext]
  )

  const handleContextMenuAction = useCallback(
    (item: ResourceEntityRailItem, action: AgentGroupAction) => {
      void executeAgentGroupAction(action, buildActionContext(item.id))
    },
    [buildActionContext]
  )

  return (
    <>
      <ResourceEntityRail
        variant="agent"
        items={items}
        selectedId={selectedId}
        status={listStatus}
        ariaLabel={t('agent.sidebar_title')}
        defaultGroupLabel={t('agent.sidebar_title')}
        addIcon={<Plus />}
        addLabel={t('agent.add.title')}
        createItemLabel={t('chat.conversation.new')}
        onAdd={onAddAgent ?? (() => onStartMissingAgentDraft?.())}
        onOpenHistoryRecords={onOpenHistoryRecords}
        onCreateItem={(item) => onStartDraftAgent(item.id)}
        onSelect={handleSelect}
        onReorder={handleReorder}
        getContextMenuActions={getContextMenuActions}
        onContextMenuAction={handleContextMenuAction}
      />
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
        onSaved={refetchAgents}
      />
    </>
  )
}
