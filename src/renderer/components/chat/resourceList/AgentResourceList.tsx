import { Archive, Pin, PinOff, Plus, Smile, SquarePen, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { deleteConversationOwnerPopup } from '@renderer/components/chat/DeleteConversationOwnerConfirmDialog'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
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
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { ipcApi } from '@renderer/ipc'
import {
  restoreRecycleBinItems,
  restoreRecycleBinUndoGroup,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { SESSION_UNKNOWN_AGENT_GROUP_ID } from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { isAgentNotFoundError, isAgentSessionNotFoundError } from '@shared/ipc/errors/ai'

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
const AGENT_ENTITY_ARCHIVE_ACTION_ID = 'agent-entity.archive'
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
  const restoreAgent = useCallback((agentId: string) => ipcApi.request('ai.agent.restore', { agentId }), [])
  const restoreSession = useCallback(
    (sessionId: string) => ipcApi.request('ai.agent.session.restore', { sessionId }),
    []
  )
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const agentIdSet = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents])
  const hasLoadedAgentMetadata = !isAgentsLoading && !agentsError
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating
  const {
    shortcuts: sidebarShortcuts,
    setPinned: setSidebarShortcutPinned,
    remove: removeSidebarShortcut
  } = useSidebarShortcuts()
  const sidebarAgentFavoriteIdSet = useMemo(
    () =>
      new Set(
        sidebarShortcuts.flatMap((shortcut) =>
          shortcut.target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT
            ? [shortcut.target.locator.resourceId]
            : []
        )
      ),
    [sidebarShortcuts]
  )
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
    async (agentId: string, permanent = false) => {
      if (deletingAgentId) return

      const deleteSessionsOnly = isProtectedBuiltinAgentRole(
        agents.find((agent) => agent.id === agentId)?.configuration?.builtin_role
      )
      const agentName = agents.find((agent) => agent.id === agentId)?.name ?? t('common.unnamed')
      if (permanent && deleteSessionsOnly) return

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
            const result = await ipcApi.request(permanent ? 'ai.agent.delete_permanently' : 'ai.agent.delete', {
              agentId,
              deleteSessions
            })
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
          if (permanent) {
            toast.success(t('settings.data.trash.permanent_delete.success'))
            return
          }
          if (deleteSessionsOnly) {
            showRecycleBinBatchUndo({
              itemCount: deletedSessionIds.length,
              onUndo: () =>
                restoreRecycleBinItems({
                  ids: deletedSessionIds,
                  restore: restoreSession,
                  getActive: (id) => dataApiService.get(`/agent-sessions/${id}`),
                  isNotFound: isAgentSessionNotFoundError,
                  refresh: refreshAfterRestore
                })
            })
          } else {
            showRecycleBinUndo({
              itemName: agentName,
              title: t('common.archived', { name: agentName }),
              description: t('agent.archive.related_resources'),
              onUndo: () =>
                restoreRecycleBinUndoGroup({
                  primary: {
                    id: agentId,
                    restore: (id) => restoreAgent(id),
                    isNotFound: isAgentNotFoundError,
                    getActive: (id) => dataApiService.get(`/agents/${id}`)
                  },
                  related: {
                    ids: deletedSessionIds,
                    restore: restoreSession,
                    getActive: (id) => dataApiService.get(`/agent-sessions/${id}`),
                    isNotFound: isAgentSessionNotFoundError
                  },
                  refresh: refreshAfterRestore
                })
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
        await performDelete(true)
        return
      }

      await deleteConversationOwnerPopup.show({ type: 'agent', permanent, action: performDelete })
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
          icon: <SidebarShortcutIcon size={14} pinned={sidebarPinned} />,
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
          id: AGENT_ENTITY_ARCHIVE_ACTION_ID,
          label: t(deleteSessionsOnly ? 'agent.session.agent.delete.trigger' : 'common.archive'),
          icon: <Archive size={14} />,
          group: 'danger',
          order: 30,
          availability: { visible: true, enabled: deletingAgentId === null }
        }),
        buildResolvedResourceEntityMenuAction({
          id: AGENT_ENTITY_DELETE_ACTION_ID,
          label: t('common.delete_permanently'),
          icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
          group: 'danger',
          order: 40,
          danger: true,
          availability: { visible: !deleteSessionsOnly, enabled: deletingAgentId === null }
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
        const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT, item.id)
        if (sidebarAgentFavoriteIdSet.has(item.id)) removeSidebarShortcut(target)
        else setSidebarShortcutPinned(target, true, item.name)
        return
      }
      if (action.id.startsWith(`${AGENT_ENTITY_ICON_TYPE_ACTION_ID}.`)) {
        void setAssistantIconType(action.id.slice(AGENT_ENTITY_ICON_TYPE_ACTION_ID.length + 1) as AssistantIconType)
        return
      }
      if (action.id === AGENT_ENTITY_DELETE_ACTION_ID || action.id === AGENT_ENTITY_ARCHIVE_ACTION_ID) {
        void handleDeleteAgent(item.id, action.id === AGENT_ENTITY_DELETE_ACTION_ID)
      }
    },
    [
      handleDeleteAgent,
      handleToggleAgentPin,
      openAgentEditor,
      removeSidebarShortcut,
      setAssistantIconType,
      sidebarAgentFavoriteIdSet,
      setSidebarShortcutPinned
    ]
  )

  const handleSelectedEntityClick = useCallback(
    (item: ResourceEntityRailItem) => {
      if (item.id === SESSION_UNKNOWN_AGENT_GROUP_ID || !activeSessionId) return handleSelect(item)
      return onSelectedAgentClick?.()
    },
    [activeSessionId, handleSelect, onSelectedAgentClick]
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
