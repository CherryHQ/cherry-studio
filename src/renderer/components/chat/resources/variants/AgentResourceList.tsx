import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ResourceEditDialogHost, type ResourceEditDialogTarget } from '@renderer/components/resource/dialogs'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { usePins } from '@renderer/hooks/usePins'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { Check, Pin, PinOff, Plus, Smile, SquarePen, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationResourceMenuItem } from '../ConversationResourceMenu'
import { SessionListOptionsMenu } from '../SessionListOptionsMenu'
import { ResourceEntityRail, type ResourceEntityRailItem } from './ResourceEntityRail'
import { sortResourceItemsByPinnedTime } from './resourceEntitySort'
import { type ResourceEntityRailReorderAnchor, useResourceEntityRail } from './useResourceEntityRail'

const logger = loggerService.withContext('AgentResourceList')

const AGENT_ENTITY_EDIT_ACTION_ID = 'agent-entity.edit'
const AGENT_ENTITY_TOGGLE_PIN_ACTION_ID = 'agent-entity.toggle-pin'
const AGENT_ENTITY_ICON_TYPE_ACTION_ID = 'agent-entity.icon-type'
const AGENT_ENTITY_DELETE_ACTION_ID = 'agent-entity.delete'
const ASSISTANT_ICON_TYPE_OPTIONS: AssistantIconType[] = ['emoji', 'model', 'none']
const ASSISTANT_ICON_TYPE_LABEL_KEYS: Record<AssistantIconType, string> = {
  emoji: 'settings.assistant.icon.type.emoji',
  model: 'settings.assistant.icon.type.model',
  none: 'settings.assistant.icon.type.none'
}

function buildModelAvatarModel(uniqueModelId: unknown, modelName: string | null | undefined) {
  if (!isUniqueModelId(uniqueModelId)) return undefined

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return {
    id: modelId,
    name: modelName || modelId,
    providerId
  }
}

type SessionListItem = AgentSessionEntity & {
  pinned?: boolean
}

type AgentResourceListProps = {
  activeAgentId?: string | null
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSelectSession: (sessionId: string, session: AgentSessionEntity) => void
  onSelectedAgentClick?: () => void | Promise<void>
  onStartDraftAgent: (agentId: string) => void | Promise<void>
  onStartMissingAgentDraft?: () => void | Promise<void>
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  /**
   * Called after the currently-active agent is deleted so the classic-layout page can
   * settle (select the latest remaining session / clear). This is the classic
   * layout's reset — unlike the modern layout it must NOT open the draft compose.
   */
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
}

export function AgentResourceList({
  activeAgentId,
  onAddAgent,
  onOpenHistoryRecords,
  onSelectSession,
  onSelectedAgentClick,
  onStartDraftAgent,
  onStartMissingAgentDraft,
  resourceMenuItems,
  onActiveAgentDeleted
}: AgentResourceListProps) {
  const { t } = useTranslation()
  const [assistantIconType, setAssistantIconType] = usePreference('assistant.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
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
  const { trigger: deleteAgent } = useMutation('DELETE', '/agents/:agentId', {
    refresh: ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const manageAgentsMenuItem = resourceMenuItems?.find((item) => item.id === 'agent-resource-view')
  const manageSkillsMenuItem = resourceMenuItems?.find((item) => item.id === 'skill-resource-view')
  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating
  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: pinIdBySessionId.has(session.id) })),
    [pinIdBySessionId, sessions]
  )

  const entities = useMemo<ResourceEntityRailItem[]>(
    () =>
      agents.map((agent) => {
        const modelAvatarModel = buildModelAvatarModel(agent.model ?? defaultModelId, agent.modelName ?? undefined)
        const icon =
          assistantIconType === 'none' ? undefined : assistantIconType === 'model' && modelAvatarModel ? (
            <ModelAvatar model={modelAvatarModel} size={24} />
          ) : (
            <EmojiIcon
              emoji={getAgentAvatarFromConfiguration(agent.configuration)}
              size={24}
              fontSize={14}
              className="mr-0"
            />
          )

        return {
          id: agent.id,
          name: agent.name,
          orderKey: agent.orderKey,
          pinned: agentPinnedIdSet.has(agent.id),
          icon
        }
      }),
    [agentPinnedIdSet, agents, assistantIconType, defaultModelId]
  )

  const sortSessionsForEntity = useCallback(
    (entitySessions: SessionListItem[]) => sortResourceItemsByPinnedTime(entitySessions, new Date()),
    []
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
      window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
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
        logger.error('Failed to toggle agent pin from classic-layout rail', { agentId, err })
        window.toast.error(t('common.error'))
      }
    },
    [isAgentPinActionDisabled, refetchAgents, t, toggleAgentPin]
  )

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      if (deletingAgentId) return

      setDeletingAgentId(agentId)
      try {
        const confirmed = await window.modal.confirm({
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

        await deleteAgent({ params: { agentId }, query: { deleteSessions: true } })
        if (activeAgentId === agentId) {
          await onActiveAgentDeleted?.(agentId)
        }

        await refetchAgents()
        await reload()
        window.toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete agent from classic-layout rail', { agentId, err })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.delete.error.failed')))
      } finally {
        setDeletingAgentId(null)
      }
    },
    [activeAgentId, deleteAgent, deletingAgentId, onActiveAgentDeleted, refetchAgents, reload, t]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem): ResolvedAction[] => {
      const pinned = agentPinnedIdSet.has(item.id)

      return [
        {
          id: AGENT_ENTITY_EDIT_ACTION_ID,
          label: t('agent.edit.title'),
          icon: <SquarePen size={14} />,
          order: 10,
          danger: false,
          availability: { visible: true, enabled: true },
          children: []
        },
        {
          id: AGENT_ENTITY_TOGGLE_PIN_ACTION_ID,
          label: pinned ? t('agent.unpin.title') : t('agent.pin.title'),
          icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
          order: 20,
          danger: false,
          availability: { visible: true, enabled: !isAgentPinActionDisabled },
          children: []
        },
        {
          id: AGENT_ENTITY_ICON_TYPE_ACTION_ID,
          label: t('agent.icon.type'),
          icon: <Smile size={14} />,
          order: 25,
          danger: false,
          availability: { visible: true, enabled: true },
          children: ASSISTANT_ICON_TYPE_OPTIONS.map((type) => ({
            id: `${AGENT_ENTITY_ICON_TYPE_ACTION_ID}.${type}`,
            label: t(ASSISTANT_ICON_TYPE_LABEL_KEYS[type]),
            icon: assistantIconType === type ? <Check size={14} /> : <span className="block size-4" />,
            order: 0,
            danger: false,
            availability: { visible: true, enabled: true },
            children: []
          }))
        },
        {
          id: AGENT_ENTITY_DELETE_ACTION_ID,
          label: t('agent.delete.title'),
          icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
          group: 'danger',
          order: 30,
          danger: true,
          availability: { visible: true, enabled: deletingAgentId === null },
          children: []
        }
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
        selectedId={selectedId}
        selectedClickId={activeAgentId}
        status={listStatus}
        ariaLabel={t('agent.sidebar_title')}
        defaultGroupLabel={t('agent.sidebar_title')}
        addIcon={<Plus />}
        addLabel={t('agent.add.title')}
        onAdd={onAddAgent ?? (() => onStartMissingAgentDraft?.())}
        headerActions={
          <SessionListOptionsMenu
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
