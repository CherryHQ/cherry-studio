import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { deleteConversationOwnerPopup } from '@renderer/components/chat/DeleteConversationOwnerConfirmDialog'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { usePins } from '@renderer/hooks/usePins'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { showRecycleBinBatchUndo, showRecycleBinUndo } from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { SESSION_UNKNOWN_AGENT_GROUP_ID } from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessageWithPrefix, getErrorMessage } from '@renderer/utils/error'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { Pin, PinOff, Plus, Smile, SquarePen, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildResolvedIconTypeMenuAction,
  buildResolvedResourceEntityMenuAction,
  renderAgentEntityIcon,
  ResourceList,
  SessionListOptionsMenu
} from './base'
import { ResourceEntityRail, type ResourceEntityRailItem } from './ResourceEntityRail'
import { type ResourceEntityRailReorderAnchor, useResourceEntityRail } from './useResourceEntityRail'

const logger = loggerService.withContext('AgentResourceList')

const AGENT_ENTITY_EDIT_ACTION_ID = 'agent-entity.edit'
const AGENT_ENTITY_TOGGLE_PIN_ACTION_ID = 'agent-entity.toggle-pin'
const AGENT_ENTITY_ICON_TYPE_ACTION_ID = 'agent-entity.icon-type'
const AGENT_ENTITY_DELETE_ACTION_ID = 'agent-entity.delete'
const AGENT_ENTITY_TOGGLE_SIDEBAR_ACTION_ID = 'agent-entity.toggle-sidebar'

type AgentResourceListProps = {
  activeAgentId?: string | null
  activeSessionId?: string | null
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  manageAgentsActive?: boolean
  agentSessionsSource: AgentSessionsSource
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onManageAgents?: () => void | Promise<void>
  onSelectSession: (sessionId: string, session: AgentSessionEntity) => void
  onSelectedAgentClick?: () => void | Promise<void>
  onCreateSession: (agentId: string) => Promise<AgentSessionEntity | null>
  onShowMissingAgentSelection?: () => void | Promise<void>
  /**
   * Called after the currently-active agent is deleted so the classic-layout page can
   * settle (select the latest remaining session / clear). This is the classic
   * layout's reset.
   */
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
}

export function AgentResourceList({
  activeAgentId,
  activeSessionId,
  dataEnabled = true,
  historyRecordsActive = false,
  manageAgentsActive = false,
  agentSessionsSource,
  onAddAgent,
  onOpenHistoryRecords,
  onManageAgents,
  onSelectSession,
  onSelectedAgentClick,
  onCreateSession,
  onShowMissingAgentSelection,
  onActiveAgentDeleted
}: AgentResourceListProps) {
  const { t } = useTranslation()
  // Agent rail icon style is stored under its own key so it no longer mutates the assistant's.
  const [assistantIconType, setAssistantIconType] = usePreference('agent.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const { agents, isLoading: isAgentsLoading, error: agentsError, refetch: refetchAgents } = useAgents()
  const {
    sessions,
    isLoading,
    isLoadingAll,
    isFullyLoaded,
    isPinsLoading,
    isValidating,
    error: sessionsError,
    reload,
    loadLatestSession
  } = agentSessionsSource
  const {
    isLoading: isAgentPinsLoading,
    isRefreshing: isAgentPinsRefreshing,
    isMutating: isAgentPinsMutating,
    pinnedIds: agentPinnedIds,
    togglePin: toggleAgentPin
  } = usePins('agent', { enabled: dataEnabled })
  const closeConversationTabs = useCloseConversationTabs()
  const invalidate = useInvalidateCache()
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })
  const { trigger: restoreAgent } = useMutation('POST', '/agents/:agentId/restore', {
    refresh: ({ args }) => ['/agents', `/agents/${args!.params.agentId}`, '/agent-sessions']
  })
  const { trigger: restoreSession } = useMutation('POST', '/agent-sessions/:sessionId/restore', {
    refresh: ['/agent-sessions']
  })
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const agentIdSet = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents])
  const hasLoadedAgentMetadata = !isAgentsLoading && !agentsError
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating
  const { agentFavoriteIds: sidebarAgentFavoriteIds, toggleAgent, removeAgent } = useSidebarFavorites()
  const sidebarAgentFavoriteIdSet = useMemo(() => new Set(sidebarAgentFavoriteIds), [sidebarAgentFavoriteIds])
  const getAgentEntityId = useCallback(
    (agentId: string | null | undefined) => {
      if (!agentId) return SESSION_UNKNOWN_AGENT_GROUP_ID
      if (!hasLoadedAgentMetadata || agentIdSet.has(agentId)) return agentId
      return SESSION_UNKNOWN_AGENT_GROUP_ID
    },
    [agentIdSet, hasLoadedAgentMetadata]
  )
  const hasUnlinkedAgentSessions = useMemo(
    () => sessions.some((session) => getAgentEntityId(session.agentId) === SESSION_UNKNOWN_AGENT_GROUP_ID),
    [getAgentEntityId, sessions]
  )
  const createSessionForAgent = useCallback(
    (agentId: string) =>
      agentId === SESSION_UNKNOWN_AGENT_GROUP_ID ? Promise.resolve(null) : onCreateSession(agentId),
    [onCreateSession]
  )
  const handleActivationError = useCallback(
    (error: unknown) => {
      logger.error('Failed to activate agent resource from classic-layout rail', { error })
      toast.error(formatErrorMessageWithPrefix(error, t('common.error')))
    },
    [t]
  )
  const handleCreateSession = useCallback(
    async (agentId: string) => {
      try {
        const session = await createSessionForAgent(agentId)
        if (session) onSelectSession(session.id, session)
      } catch (error) {
        handleActivationError(error)
      }
    },
    [createSessionForAgent, handleActivationError, onSelectSession]
  )

  const entities = useMemo<ResourceEntityRailItem[]>(() => {
    const unlinkedAgentEntity: ResourceEntityRailItem[] = hasUnlinkedAgentSessions
      ? [
          {
            id: SESSION_UNKNOWN_AGENT_GROUP_ID,
            name: t('agent.session.group.unknown_agent'),
            tooltip: t('agent.session.group.unknown_agent_tip'),
            reorderable: false
          }
        ]
      : []

    return [
      ...agents.map((agent) => {
        const icon = renderAgentEntityIcon(assistantIconType, agent, defaultModelId)

        return {
          id: agent.id,
          name: agent.name,
          orderKey: agent.orderKey,
          pinned: agentPinnedIdSet.has(agent.id),
          icon,
          trailingAction: (
            <Tooltip title={t('agent.session.new')} delay={500}>
              <ResourceList.GroupHeaderActionButton
                type="button"
                aria-label={t('agent.session.new')}
                onClick={() => {
                  void handleCreateSession(agent.id)
                }}>
                <NewConversationIcon className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )
        }
      }),
      ...unlinkedAgentEntity
    ]
  }, [agentPinnedIdSet, agents, assistantIconType, defaultModelId, handleCreateSession, hasUnlinkedAgentSessions, t])

  const handlePickSession = useCallback(
    (session: AgentSessionEntity) => onSelectSession(session.id, session),
    [onSelectSession]
  )
  const loadLatestSessionForAgent = useCallback(
    (agentId: string) => loadLatestSession(agentId === SESSION_UNKNOWN_AGENT_GROUP_ID ? null : agentId),
    [loadLatestSession]
  )
  const activeAgentEntityId = getAgentEntityId(activeAgentId)
  const reorderAgentEntity = useCallback(
    async (agentId: string, anchor: ResourceEntityRailReorderAnchor) => {
      if (agentId === SESSION_UNKNOWN_AGENT_GROUP_ID) return

      await reorderAgent({ params: { id: agentId }, body: anchor })
    },
    [reorderAgent]
  )
  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder agent classic-layout rail', { error })
      toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
    },
    [t]
  )
  const { items, listStatus, selectedId, handleSelect, handleReorder } = useResourceEntityRail({
    entities,
    activeEntityId: activeAgentEntityId,
    isLoading: isAgentsLoading || isLoading || isLoadingAll || !isFullyLoaded || isPinsLoading,
    isError: !!(agentsError || sessionsError),
    onPickResource: handlePickSession,
    loadResourceForEntity: loadLatestSessionForAgent,
    onCreateResource: createSessionForAgent,
    onActivationError: handleActivationError,
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
      } catch (err) {
        logger.error('Failed to toggle agent pin from classic-layout rail', { agentId, err })
        toast.error(t('common.error'))
        return
      }

      try {
        await refetchAgents()
      } catch (err) {
        logger.warn('Failed to refresh agents after toggling pin from classic-layout rail', { agentId, err })
      }
    },
    [isAgentPinActionDisabled, refetchAgents, t, toggleAgentPin]
  )

  const refreshAfterRestore = useCallback(async () => {
    const outcomes = await Promise.allSettled([refetchAgents(), reload()])
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('Failed to refresh Agent resources after restore from classic-layout rail', {
          err: outcome.reason
        })
      }
    }
  }, [refetchAgents, reload])

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      if (deletingAgentId) return

      const deleteSessionsOnly = isProtectedBuiltinAgentRole(
        agents.find((agent) => agent.id === agentId)?.configuration?.builtin_role
      )
      const agentName = agents.find((agent) => agent.id === agentId)?.name ?? t('common.unnamed')

      const performDelete = async (deleteSessions: boolean) => {
        setDeletingAgentId(agentId)
        try {
          let deletedSessionIds: string[] = []
          let deletionChangedState = false
          if (deleteSessionsOnly) {
            const result = await ipcApi.request('ai.agent.sessions.delete', { agentId })
            deletedSessionIds = result.deletedIds
            deletionChangedState = deletedSessionIds.length > 0
          } else {
            const result = await ipcApi.request('ai.agent.delete', { agentId, deleteSessions })
            deletionChangedState = result.deleted
            deletedSessionIds = result.deletedSessionIds ?? []
          }
          if (deletedSessionIds.length > 0) closeConversationTabs('agents', deletedSessionIds)

          const invalidateOutcomes = await Promise.allSettled(
            ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels'].map((key) =>
              invalidate(key)
            )
          )
          if (invalidateOutcomes.some((outcome) => outcome.status === 'rejected')) {
            logger.warn('Failed to refresh after deleting Agent from classic-layout rail', { agentId })
          }
          const reloadResources = async () => {
            try {
              await Promise.all([...(deleteSessionsOnly ? [] : [refetchAgents()]), reload()])
            } catch (err) {
              logger.warn('Failed to reload resources after deleting Agent from classic-layout rail', { agentId, err })
            }
          }
          if (!deletionChangedState) {
            await reloadResources()
            toast.info(t('recycle_bin.already_moved'))
            return
          }

          if (activeSessionId && deletedSessionIds.includes(activeSessionId)) {
            try {
              await onActiveAgentDeleted?.(agentId)
            } catch (err) {
              logger.warn('Failed to reconcile active Agent after deletion from classic-layout rail', { agentId, err })
            }
          }

          await reloadResources()
          if (deleteSessionsOnly) {
            showRecycleBinBatchUndo({
              itemCount: deletedSessionIds.length,
              onUndo: async () => {
                const outcomes = await Promise.allSettled(
                  deletedSessionIds.map((sessionId) => restoreSession({ params: { sessionId } }))
                )
                await refreshAfterRestore()
                const activeAfterNotFound = await Promise.all(
                  outcomes.map(async (outcome, index) => {
                    if (outcome.status === 'fulfilled' || !isDataApiNotFoundError(outcome.reason)) return false
                    try {
                      await dataApiService.get(`/agent-sessions/${deletedSessionIds[index]}`)
                      return true
                    } catch {
                      return false
                    }
                  })
                )
                return outcomes.reduce(
                  (result, outcome, index) => {
                    const sessionId = deletedSessionIds[index]
                    if (outcome.status === 'fulfilled' || activeAfterNotFound[index]) result.restored.push(sessionId)
                    else result.failed.push({ id: sessionId, error: getErrorMessage(outcome.reason) })
                    return result
                  },
                  { restored: [] as string[], failed: [] as Array<{ id: string; error: string }> }
                )
              }
            })
          } else {
            showRecycleBinUndo({
              itemName: agentName,
              onUndo: async () => {
                try {
                  await restoreAgent({ params: { agentId } })
                } catch (err) {
                  if (!isDataApiNotFoundError(err)) throw err
                  await refreshAfterRestore()
                  try {
                    await dataApiService.get(`/agents/${agentId}`)
                    return
                  } catch {
                    throw err
                  }
                }
                await refreshAfterRestore()
              }
            })
          }
        } catch (err) {
          logger.error('Failed to delete agent from classic-layout rail', { agentId, err })
          if (!deleteSessionsOnly) throw err
          toast.error(formatErrorMessageWithPrefix(err, t('agent.delete.error.failed')))
        } finally {
          setDeletingAgentId(null)
        }
      }

      if (deleteSessionsOnly) {
        const confirmed = await popup.confirm({
          title: t('agent.session.agent.delete.title'),
          content: t('agent.session.agent.delete.content'),
          okText: t('agent.session.agent.delete.trigger'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return
        await performDelete(true)
        return
      }

      await deleteConversationOwnerPopup.show({ type: 'agent', action: performDelete })
    },
    [
      activeSessionId,
      agents,
      closeConversationTabs,
      deletingAgentId,
      invalidate,
      onActiveAgentDeleted,
      refreshAfterRestore,
      refetchAgents,
      reload,
      restoreAgent,
      restoreSession,
      t
    ]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem): ResolvedAction[] => {
      if (item.id === SESSION_UNKNOWN_AGENT_GROUP_ID) return []

      const pinned = agentPinnedIdSet.has(item.id)
      const sidebarPinned = sidebarAgentFavoriteIdSet.has(item.id)
      const deleteSessionsOnly = isProtectedBuiltinAgentRole(
        agents.find((agent) => agent.id === item.id)?.configuration?.builtin_role
      )

      return [
        buildResolvedResourceEntityMenuAction({
          id: AGENT_ENTITY_EDIT_ACTION_ID,
          label: t('agent.edit.title'),
          icon: <SquarePen size={14} />,
          order: 10
        }),
        buildResolvedResourceEntityMenuAction({
          id: AGENT_ENTITY_TOGGLE_PIN_ACTION_ID,
          label: pinned ? t('agent.unpin.title') : t('agent.pin.title'),
          icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
          order: 20,
          availability: { visible: true, enabled: !isAgentPinActionDisabled }
        }),
        buildResolvedResourceEntityMenuAction({
          id: AGENT_ENTITY_TOGGLE_SIDEBAR_ACTION_ID,
          label: sidebarPinned ? t('launchpad.unpin_from_sidebar') : t('launchpad.pin_to_sidebar'),
          icon: sidebarPinned ? <PinOff size={14} /> : <Pin size={14} />,
          order: 22
        }),
        buildResolvedIconTypeMenuAction(
          AGENT_ENTITY_ICON_TYPE_ACTION_ID,
          t('agent.icon.type'),
          <Smile size={14} />,
          25,
          assistantIconType,
          t
        ),
        buildResolvedResourceEntityMenuAction({
          id: AGENT_ENTITY_DELETE_ACTION_ID,
          label: t(deleteSessionsOnly ? 'agent.session.agent.delete.trigger' : 'agent.delete.title'),
          icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
          group: 'danger',
          order: 30,
          danger: true,
          availability: { visible: true, enabled: deletingAgentId === null }
        })
      ]
    },
    [
      agentPinnedIdSet,
      agents,
      assistantIconType,
      deletingAgentId,
      isAgentPinActionDisabled,
      sidebarAgentFavoriteIdSet,
      t
    ]
  )

  const handleContextMenuAction = useCallback(
    (item: ResourceEntityRailItem, action: ResolvedAction) => {
      if (action.id === AGENT_ENTITY_EDIT_ACTION_ID) {
        openAgentEditor(item.id)
        return
      }
      if (action.id === AGENT_ENTITY_TOGGLE_PIN_ACTION_ID) {
        void handleToggleAgentPin(item.id)
        return
      }
      if (action.id === AGENT_ENTITY_TOGGLE_SIDEBAR_ACTION_ID) {
        if (sidebarAgentFavoriteIdSet.has(item.id)) removeAgent(item.id)
        else toggleAgent(item.id)
        return
      }
      if (action.id.startsWith(`${AGENT_ENTITY_ICON_TYPE_ACTION_ID}.`)) {
        void setAssistantIconType(action.id.slice(AGENT_ENTITY_ICON_TYPE_ACTION_ID.length + 1) as AssistantIconType)
        return
      }
      if (action.id === AGENT_ENTITY_DELETE_ACTION_ID) {
        void handleDeleteAgent(item.id)
      }
    },
    [
      handleDeleteAgent,
      handleToggleAgentPin,
      openAgentEditor,
      removeAgent,
      setAssistantIconType,
      sidebarAgentFavoriteIdSet,
      toggleAgent
    ]
  )

  const handleSelectedEntityClick = useCallback(
    (item: ResourceEntityRailItem) => {
      const hasSession = sessions.some((session) => getAgentEntityId(session.agentId) === item.id)
      if (item.id === SESSION_UNKNOWN_AGENT_GROUP_ID || !hasSession) return handleSelect(item)
      return onSelectedAgentClick?.()
    },
    [getAgentEntityId, handleSelect, onSelectedAgentClick, sessions]
  )

  return (
    <>
      <ResourceEntityRail
        variant="agent"
        items={items}
        selectedId={selectedId}
        selectedClickId={manageAgentsActive ? null : activeAgentEntityId}
        selectionSuppressed={manageAgentsActive || historyRecordsActive}
        status={listStatus}
        ariaLabel={t('agent.sidebar_title')}
        defaultGroupLabel={t('agent.sidebar_title')}
        addIcon={<Plus />}
        addLabel={t('agent.add.title')}
        onAdd={onAddAgent ?? (() => onShowMissingAgentSelection?.())}
        headerActions={
          <SessionListOptionsMenu
            historyRecordsActive={historyRecordsActive}
            manageAgentsActive={manageAgentsActive}
            mode={sessionDisplayMode}
            onChange={(nextMode) => void setSessionDisplayMode(nextMode)}
            onManageAgents={onManageAgents}
            onOpenHistoryRecords={onOpenHistoryRecords}
          />
        }
        onSelect={handleSelect}
        onSelectedClick={handleSelectedEntityClick}
        onReorder={handleReorder}
        reorderEnabled={isFullyLoaded && !isLoadingAll && !isValidating}
        getContextMenuActions={getContextMenuActions}
        onContextMenuAction={handleContextMenuAction}
      />
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
      />
    </>
  )
}
