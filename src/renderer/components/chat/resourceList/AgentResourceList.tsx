import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useBuiltinAgentListVisibility } from '@renderer/hooks/agent/useBuiltinAgentListVisibility'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { usePins } from '@renderer/hooks/usePins'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { EyeOff, Pin, PinOff, Plus, Smile, SquarePen, Trash2 } from 'lucide-react'
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
const AGENT_ENTITY_HIDE_FROM_LIST_ACTION_ID = 'agent-entity.hide-from-list'
const AGENT_ENTITY_TOGGLE_SIDEBAR_ACTION_ID = 'agent-entity.toggle-sidebar'

type SessionListItem = AgentSessionEntity & {
  pinned?: boolean
}

type AgentResourceListProps = {
  activeAgentId?: string | null
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
  const { hiddenBuiltinAgentIds, hideBuiltinAgent } = useBuiltinAgentListVisibility()
  const { agents, isLoading: isAgentsLoading, error: agentsError, refetch: refetchAgents } = useAgents()
  const {
    sessions,
    pinIdBySessionId,
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
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating
  const { agentFavoriteIds: sidebarAgentFavoriteIds, toggleAgent, removeAgent } = useSidebarFavorites()
  const sidebarAgentFavoriteIdSet = useMemo(() => new Set(sidebarAgentFavoriteIds), [sidebarAgentFavoriteIds])
  const hiddenBuiltinAgentIdSet = useMemo(() => new Set(hiddenBuiltinAgentIds), [hiddenBuiltinAgentIds])
  const handleHideBuiltinAgent = useCallback(
    async (agentId: string) => {
      await hideBuiltinAgent(agentId)
    },
    [hideBuiltinAgent]
  )
  const hiddenProtectedAgentIdSet = useMemo(
    () =>
      new Set(
        agents
          .filter(
            (agent) =>
              hiddenBuiltinAgentIdSet.has(agent.id) && isProtectedBuiltinAgentRole(agent.configuration?.builtin_role)
          )
          .map((agent) => agent.id)
      ),
    [agents, hiddenBuiltinAgentIdSet]
  )
  const visibleAgents = useMemo(
    () => agents.filter((agent) => !hiddenProtectedAgentIdSet.has(agent.id)),
    [agents, hiddenProtectedAgentIdSet]
  )
  const sessionItems = useMemo<SessionListItem[]>(
    () =>
      sessions
        .filter((session) => !session.agentId || !hiddenProtectedAgentIdSet.has(session.agentId))
        .map((session) => ({ ...session, pinned: pinIdBySessionId.has(session.id) })),
    [hiddenProtectedAgentIdSet, pinIdBySessionId, sessions]
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
        const session = await onCreateSession(agentId)
        if (session) onSelectSession(session.id, session)
      } catch (error) {
        handleActivationError(error)
      }
    },
    [handleActivationError, onCreateSession, onSelectSession]
  )

  const entities = useMemo<ResourceEntityRailItem[]>(
    () =>
      visibleAgents.map((agent) => {
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
    [agentPinnedIdSet, assistantIconType, defaultModelId, handleCreateSession, t, visibleAgents]
  )

  const getSessionAgentId = useCallback((session: SessionListItem) => session.agentId, [])
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
      logger.error('Failed to reorder agent classic-layout rail', { error })
      toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
    },
    [t]
  )
  const { items, listStatus, selectedId, handleSelect, handleReorder } = useResourceEntityRail({
    entities,
    resources: sessionItems,
    getResourceParentId: getSessionAgentId,
    activeEntityId: activeAgentId,
    isLoading: isAgentsLoading || isLoading || isLoadingAll || !isFullyLoaded || isPinsLoading,
    isError: !!(agentsError || sessionsError),
    onPickResource: handlePickSession,
    loadResourceForEntity: loadLatestSession,
    onCreateResource: onCreateSession,
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

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      if (deletingAgentId) return

      setDeletingAgentId(agentId)
      try {
        const confirmed = await popup.confirm({
          title: t('agent.delete.title'),
          content: t('agent.delete.content'),
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        const result = await ipcApi.request('ai.agent.delete', { agentId, deleteSessions: true })
        closeConversationTabs('agents', result.deletedSessionIds ?? [])
        try {
          await Promise.all(
            ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels'].map((key) =>
              invalidate(key)
            )
          )
        } catch (err) {
          logger.warn('Failed to refresh after deleting Agent from classic-layout rail', { agentId, err })
        }
        if (activeAgentId === agentId) {
          try {
            await onActiveAgentDeleted?.(agentId)
          } catch (err) {
            logger.warn('Failed to reconcile active Agent after deletion from classic-layout rail', { agentId, err })
          }
        }

        try {
          await Promise.all([refetchAgents(), reload()])
        } catch (err) {
          logger.warn('Failed to reload resources after deleting Agent from classic-layout rail', { agentId, err })
        }
        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete agent from classic-layout rail', { agentId, err })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.delete.error.failed')))
      } finally {
        setDeletingAgentId(null)
      }
    },
    [activeAgentId, closeConversationTabs, deletingAgentId, invalidate, onActiveAgentDeleted, refetchAgents, reload, t]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem): ResolvedAction[] => {
      const pinned = agentPinnedIdSet.has(item.id)
      const sidebarPinned = sidebarAgentFavoriteIdSet.has(item.id)
      const protectedBuiltin = isProtectedBuiltinAgentRole(
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
        protectedBuiltin
          ? buildResolvedResourceEntityMenuAction({
              id: AGENT_ENTITY_HIDE_FROM_LIST_ACTION_ID,
              label: t('agent.session.agent.hide_from_list'),
              icon: <EyeOff size={14} />,
              order: 30
            })
          : buildResolvedResourceEntityMenuAction({
              id: AGENT_ENTITY_DELETE_ACTION_ID,
              label: t('agent.delete.title'),
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
        return
      }
      if (action.id === AGENT_ENTITY_HIDE_FROM_LIST_ACTION_ID) {
        void handleHideBuiltinAgent(item.id)
      }
    },
    [
      handleDeleteAgent,
      handleHideBuiltinAgent,
      handleToggleAgentPin,
      openAgentEditor,
      removeAgent,
      setAssistantIconType,
      sidebarAgentFavoriteIdSet,
      toggleAgent
    ]
  )

  return (
    <>
      <ResourceEntityRail
        variant="agent"
        items={items}
        selectedId={selectedId}
        selectedClickId={manageAgentsActive ? null : activeAgentId}
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
        onSelectedClick={() => void onSelectedAgentClick?.()}
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
