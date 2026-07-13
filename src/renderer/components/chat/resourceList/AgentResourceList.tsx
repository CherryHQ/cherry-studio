import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { usePins } from '@renderer/hooks/usePins'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { Pin, PinOff, Plus, Smile, SquarePen, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildResolvedIconTypeMenuAction,
  buildResolvedResourceEntityMenuAction,
  type ConversationResourceMenuItem,
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

type SessionListItem = AgentSessionEntity & {
  pinned?: boolean
}

type AgentResourceListProps = {
  activeAgentId?: string | null
  historyRecordsActive?: boolean
  agentSessionsSource: AgentSessionsSource
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSelectSession: (sessionId: string, session: AgentSessionEntity) => void
  onSelectedAgentClick?: () => void | Promise<void>
  onCreateSession: (agentId: string) => void | Promise<unknown>
  onShowMissingAgentSelection?: () => void | Promise<void>
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  /**
   * Called after the currently-active agent is deleted so the classic-layout page can
   * settle (select the latest remaining session / clear). This is the classic
   * layout's reset.
   */
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
}

export function AgentResourceList({
  activeAgentId,
  historyRecordsActive = false,
  agentSessionsSource,
  onAddAgent,
  onOpenHistoryRecords,
  onSelectSession,
  onSelectedAgentClick,
  onCreateSession,
  onShowMissingAgentSelection,
  resourceMenuItems,
  onActiveAgentDeleted
}: AgentResourceListProps) {
  const { t } = useTranslation()
  // Agent rail icon style is stored under its own key so it no longer mutates the assistant's.
  const [assistantIconType, setAssistantIconType] = usePreference('agent.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const { agents, isLoading: isAgentsLoading, error: agentsError, refetch: refetchAgents } = useAgents()
  const {
    stats: sessionStats,
    isStatsLoading: isSessionStatsLoading,
    statsError: sessionsError,
    refetchStats: reload,
    loadFirstSession
  } = agentSessionsSource
  const {
    isLoading: isAgentPinsLoading,
    isRefreshing: isAgentPinsRefreshing,
    isMutating: isAgentPinsMutating,
    pinnedIds: agentPinnedIds,
    togglePin: toggleAgentPin
  } = usePins('agent')
  const closeConversationTabs = useCloseConversationTabs()
  const { trigger: deleteAgent } = useMutation('DELETE', '/agents/:agentId', {
    refresh: ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const manageAgentsMenuItem = resourceMenuItems?.find((item) => item.id === 'agent-resource-view')
  const manageSkillsMenuItem = resourceMenuItems?.find((item) => item.id === 'skill-resource-view')
  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating
  const sessionCountByAgentId = useMemo(
    () =>
      new Map(
        (sessionStats?.byAgent ?? []).flatMap(({ agentId, count }) => (agentId ? [[agentId, count] as const] : []))
      ),
    [sessionStats?.byAgent]
  )

  const entities = useMemo<ResourceEntityRailItem[]>(
    () =>
      agents.map((agent) => {
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
                  void onCreateSession(agent.id)
                }}>
                <SquarePen className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )
        }
      }),
    [agentPinnedIdSet, agents, assistantIconType, defaultModelId, onCreateSession, t]
  )

  const handlePickSession = useCallback(
    (session: SessionListItem) => onSelectSession(session.id, session),
    [onSelectSession]
  )
  const loadFirstSessionForAgent = useCallback((agentId: string) => loadFirstSession(agentId), [loadFirstSession])
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
    resourceCountByEntityId: sessionCountByAgentId,
    activeEntityId: activeAgentId,
    isLoading: isAgentsLoading || isSessionStatsLoading,
    isError: !!(agentsError || sessionsError),
    onPickResource: handlePickSession,
    loadFirstResource: loadFirstSessionForAgent,
    onCreateResource: onCreateSession,
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
        logger.error('Failed to toggle agent pin from classic-layout rail', { agentId, err })
        toast.error(t('common.error'))
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

        const result = await deleteAgent({ params: { agentId }, query: { deleteSessions: true } })
        closeConversationTabs('agents', result.deletedSessionIds ?? [])
        if (activeAgentId === agentId) {
          await onActiveAgentDeleted?.(agentId)
        }

        await refetchAgents()
        await reload()
        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete agent from classic-layout rail', { agentId, err })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.delete.error.failed')))
      } finally {
        setDeletingAgentId(null)
      }
    },
    [activeAgentId, closeConversationTabs, deleteAgent, deletingAgentId, onActiveAgentDeleted, refetchAgents, reload, t]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem): ResolvedAction[] => {
      const pinned = agentPinnedIdSet.has(item.id)

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
          label: t('agent.delete.title'),
          icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
          group: 'danger',
          order: 30,
          danger: true,
          availability: { visible: true, enabled: deletingAgentId === null }
        })
      ]
    },
    [agentPinnedIdSet, assistantIconType, deletingAgentId, isAgentPinActionDisabled, t]
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
      if (action.id.startsWith(`${AGENT_ENTITY_ICON_TYPE_ACTION_ID}.`)) {
        void setAssistantIconType(action.id.slice(AGENT_ENTITY_ICON_TYPE_ACTION_ID.length + 1) as AssistantIconType)
        return
      }
      if (action.id === AGENT_ENTITY_DELETE_ACTION_ID) {
        void handleDeleteAgent(item.id)
      }
    },
    [handleDeleteAgent, handleToggleAgentPin, openAgentEditor, setAssistantIconType]
  )

  return (
    <>
      <ResourceEntityRail
        variant="agent"
        items={items}
        selectedId={hasActiveResourceMenuItem ? null : selectedId}
        selectedClickId={hasActiveResourceMenuItem ? null : activeAgentId}
        status={listStatus}
        ariaLabel={t('agent.sidebar_title')}
        defaultGroupLabel={t('agent.sidebar_title')}
        addIcon={<Plus />}
        addLabel={t('agent.add.title')}
        historyRecordsActive={historyRecordsActive}
        onAdd={onAddAgent ?? (() => onShowMissingAgentSelection?.())}
        headerActions={
          <SessionListOptionsMenu
            historyRecordsActive={historyRecordsActive}
            manageAgentsActive={manageAgentsMenuItem?.active}
            manageSkillsActive={manageSkillsMenuItem?.active}
            manageSkillsIcon={manageSkillsMenuItem?.icon}
            mode={sessionDisplayMode}
            onChange={(nextMode) => void setSessionDisplayMode(nextMode)}
            onManageAgents={manageAgentsMenuItem?.onSelect}
            onManageSkills={manageSkillsMenuItem?.onSelect}
            onOpenHistoryRecords={onOpenHistoryRecords}
          />
        }
        onSelect={handleSelect}
        onSelectedClick={() => void onSelectedAgentClick?.()}
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
