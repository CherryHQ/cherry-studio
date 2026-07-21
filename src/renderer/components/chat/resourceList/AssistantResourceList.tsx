import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { useGroups } from '@renderer/hooks/useGroups'
import { usePins } from '@renderer/hooks/usePins'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import { BrushCleaning, Edit3, PinIcon, PinOffIcon, Plus, Smile, SquarePen, Tags, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildResolvedIconTypeMenuAction,
  buildResolvedResourceEntityMenuAction,
  buildResourceOwnerFallbackIds,
  type ConversationResourceMenuItem,
  renderAssistantEntityIcon,
  ResourceList,
  TopicListOptionsMenu
} from './base'
import {
  ResourceEntityRail,
  type ResourceEntityRailItem,
  sortEntityRailItemsForGroupGrouping
} from './ResourceEntityRail'
import { type ResourceEntityRailReorderAnchor, useResourceEntityRail } from './useResourceEntityRail'

const logger = loggerService.withContext('AssistantResourceList')

const ASSISTANT_ENTITY_EDIT_ACTION_ID = 'assistant-entity.edit'
const ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID = 'assistant-entity.toggle-pin'
const ASSISTANT_ENTITY_CLEAR_TOPICS_ACTION_ID = 'assistant-entity.clear-topics'
const ASSISTANT_ENTITY_TOGGLE_GROUPING_ACTION_ID = 'assistant-entity.toggle-grouping'
const ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID = 'assistant-entity.icon-type'
const ASSISTANT_ENTITY_DELETE_ACTION_ID = 'assistant-entity.delete'
const DEFAULT_ASSISTANT_ENTITY_ID = 'assistant-entity:default'

type AssistantResourceListProps = {
  activeAssistantId?: string | null
  historyRecordsActive?: boolean
  assistantTopicsSource: AssistantTopicsSource
  onAddAssistant?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSelectTopic: (topic: Topic) => void | boolean
  onSelectEmptyAssistant?: (assistantId: string | null) => void
  onClearActiveTopic?: (assistantId: string) => void
  onSelectedAssistantClick?: () => void | Promise<void>
  onCreateTopic: (assistantId: string | null) => void | Promise<void>
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  /**
   * Called after the active assistant is deleted or loses its last topic. The
   * candidate ids preserve the owner rail's pre-removal display order.
   */
  onActiveAssistantDeleted?: (
    assistantId: string,
    candidateAssistantIds: readonly string[],
    reason: 'deleted' | 'emptied'
  ) => void | Promise<void>
}

export function AssistantResourceList({
  activeAssistantId,
  historyRecordsActive = false,
  assistantTopicsSource,
  onAddAssistant,
  onOpenHistoryRecords,
  onSelectTopic,
  onSelectEmptyAssistant,
  onClearActiveTopic,
  onSelectedAssistantClick,
  onCreateTopic,
  resourceMenuItems,
  onActiveAssistantDeleted
}: AssistantResourceListProps) {
  const { t } = useTranslation()
  const [assistantSortType, setAssistantSortType] = usePreference('assistant.tab.sort_type')
  const [assistantIconType, setAssistantIconType] = usePreference('assistant.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [topicSortBy, setTopicSortBy] = usePreference('topic.sort_type')
  // Keep the persisted legacy token (`tags`) for preference compatibility; runtime grouping uses Group rows.
  const isGroupGrouping = assistantSortType === 'tags'
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const manageAssistantsMenuItem = resourceMenuItems?.find((item) => item.id === 'assistant-resource-view')
  const {
    assistants,
    isLoading: isAssistantsLoading,
    error: assistantsError,
    refetch: refreshAssistants
  } = useAssistantsApi()
  const {
    stats: topicStats,
    isStatsLoading: isTopicStatsLoading,
    statsError: topicsError,
    loadLatestTopic
  } = assistantTopicsSource
  const {
    groups: assistantGroups,
    isLoading: isAssistantGroupsLoading,
    error: assistantGroupsError
  } = useGroups('assistant')
  const {
    isLoading: isAssistantPinsLoading,
    isMutating: isAssistantPinsMutating,
    isRefreshing: isAssistantPinsRefreshing,
    pinnedIds: assistantPinnedIds,
    togglePin: toggleAssistantPin
  } = usePins('assistant')
  const closeConversationTabs = useCloseConversationTabs()
  const { deleteAssistant } = useAssistantMutations()
  const { deleteTopicsByAssistantId, refreshTopics } = useTopicMutations()
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null)
  const [clearingTopicsAssistantId, setClearingTopicsAssistantId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const assistantPinnedIdSet = useMemo(() => new Set(assistantPinnedIds), [assistantPinnedIds])
  const assistantGroupById = useMemo(
    () => new Map(assistantGroups.map((group) => [group.id, group] as const)),
    [assistantGroups]
  )
  const isAssistantPinActionDisabled = isAssistantPinsLoading || isAssistantPinsRefreshing || isAssistantPinsMutating
  const topicCountByAssistantId = useMemo(() => {
    const assistantIds = new Set(assistants.map((assistant) => assistant.id))
    return new Map(
      (topicStats?.byAssistant ?? []).flatMap(({ assistantId, count }) => {
        if (assistantId === null) return [[DEFAULT_ASSISTANT_ENTITY_ID, count]] as const
        return assistantIds.has(assistantId) ? ([[assistantId, count]] as const) : []
      })
    )
  }, [assistants, topicStats?.byAssistant])

  // Keep the latest per-assistant topic counts in a ref so a clear action that
  // is awaiting its confirm dialog can re-check the count after the user
  // confirms — the list may have drained while the dialog was open.
  const topicCountByAssistantIdRef = useRef(topicCountByAssistantId)
  useEffect(() => {
    topicCountByAssistantIdRef.current = topicCountByAssistantId
  }, [topicCountByAssistantId])

  const handleCreateTopic = useCallback(
    (assistantId: string) => onCreateTopic(assistantId === DEFAULT_ASSISTANT_ENTITY_ID ? null : assistantId),
    [onCreateTopic]
  )
  const entities = useMemo<ResourceEntityRailItem[]>(() => {
    const hasDefaultAssistantTopics = (topicCountByAssistantId.get(DEFAULT_ASSISTANT_ENTITY_ID) ?? 0) > 0
    const defaultAssistantEntity: ResourceEntityRailItem[] = hasDefaultAssistantTopics
      ? [
          {
            id: DEFAULT_ASSISTANT_ENTITY_ID,
            name: t('chat.default.name'),
            icon: renderAssistantEntityIcon(
              assistantIconType,
              {
                emoji: DEFAULT_ASSISTANT_EMOJI
              },
              defaultModelId
            ),
            reorderable: false
            // No "new topic" action: the default group is only a display bucket for legacy
            // assistant-less topics. A null-assistant create can't reuse an empty placeholder
            // (findReusableEmptyTopic bails without an assistantId), so it would stack blanks.
          }
        ]
      : []

    return [
      ...assistants.map((assistant) => {
        const group = assistant.groupId ? assistantGroupById.get(assistant.groupId) : undefined
        const icon = renderAssistantEntityIcon(
          assistantIconType,
          {
            emoji: assistant.emoji,
            modelId: assistant.modelId,
            modelName: assistant.modelName
          },
          defaultModelId
        )

        return {
          id: assistant.id,
          name: assistant.name,
          orderKey: assistant.orderKey,
          pinned: assistantPinnedIdSet.has(assistant.id),
          groupId: group?.id,
          groupName: group?.name,
          groupOrderKey: group?.orderKey,
          icon,
          trailingAction: (
            <Tooltip title={t('chat.conversation.new')} delay={500}>
              <ResourceList.GroupHeaderActionButton
                type="button"
                aria-label={t('chat.conversation.new')}
                onClick={() => {
                  void handleCreateTopic(assistant.id)
                }}>
                <SquarePen className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )
        }
      }),
      ...defaultAssistantEntity
    ]
  }, [
    assistantGroupById,
    assistantIconType,
    assistants,
    assistantPinnedIdSet,
    defaultModelId,
    handleCreateTopic,
    t,
    topicCountByAssistantId
  ])

  const loadLatestTopicForEntity = useCallback(
    async (assistantId: string) => {
      const topic = await loadLatestTopic(assistantId === DEFAULT_ASSISTANT_ENTITY_ID ? null : assistantId)
      return topic ? mapApiTopicToRendererTopic(topic) : null
    },
    [loadLatestTopic]
  )
  const handleEmptyAssistantSelection = useCallback(
    (assistant: ResourceEntityRailItem) =>
      onSelectEmptyAssistant?.(assistant.id === DEFAULT_ASSISTANT_ENTITY_ID ? null : assistant.id),
    [onSelectEmptyAssistant]
  )
  const { trigger: reorderAssistantOrder } = useMutation('PATCH', '/assistants/:id/order', { refresh: ['/assistants'] })
  const reorderAssistant = useCallback(
    async (assistantId: string, anchor: ResourceEntityRailReorderAnchor) => {
      if (assistantId === DEFAULT_ASSISTANT_ENTITY_ID) return

      await reorderAssistantOrder({ params: { id: assistantId }, body: anchor })
    },
    [reorderAssistantOrder]
  )
  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder assistant classic-layout rail', { error })
      toast.error(formatErrorMessageWithPrefix(error, t('assistants.reorder.error.failed')))
    },
    [t]
  )

  const { items, listStatus, selectedId, handleSelect, handleReorder } = useResourceEntityRail({
    entities,
    resourceCountByEntityId: topicCountByAssistantId,
    activeEntityId: activeAssistantId ?? DEFAULT_ASSISTANT_ENTITY_ID,
    isLoading: isAssistantsLoading || isTopicStatsLoading || (isGroupGrouping && isAssistantGroupsLoading),
    isError: !!(assistantsError || (isGroupGrouping && assistantGroupsError) || topicsError),
    onPickResource: onSelectTopic,
    onEmptyResource: handleEmptyAssistantSelection,
    loadResourceForEntity: loadLatestTopicForEntity,
    reorder: reorderAssistant,
    refetchEntities: refreshAssistants,
    onReorderError: handleReorderError
  })
  const displayedAssistantIds = useMemo(
    () =>
      (isGroupGrouping ? sortEntityRailItemsForGroupGrouping(items) : items)
        .map((item) => item.id)
        .filter((assistantId) => assistantId !== DEFAULT_ASSISTANT_ENTITY_ID),
    [isGroupGrouping, items]
  )

  const openAssistantEditor = useCallback((assistantId: string) => {
    setEditDialogTarget({ kind: 'assistant', id: assistantId })
  }, [])

  const handleToggleAssistantPin = useCallback(
    async (assistantId: string) => {
      if (isAssistantPinActionDisabled) return

      try {
        await toggleAssistantPin(assistantId)
        await refreshAssistants()
      } catch (err) {
        logger.error('Failed to toggle assistant pin from classic-layout rail', { assistantId, err })
        toast.error(t('common.error'))
      }
    },
    [isAssistantPinActionDisabled, refreshAssistants, t, toggleAssistantPin]
  )

  const handleClearAssistantTopics = useCallback(
    async (assistantId: string) => {
      if (clearingTopicsAssistantId || deletingAssistantId) return

      if ((topicCountByAssistantId.get(assistantId) ?? 0) === 0) return

      setClearingTopicsAssistantId(assistantId)
      try {
        const confirmed = await popup.confirm({
          title: t('assistants.clear.title'),
          content: t('assistants.clear.content'),
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        // The list may have drained while the confirm dialog was open — re-check
        // the latest count so we don't issue a redundant scoped delete.
        if ((topicCountByAssistantIdRef.current.get(assistantId) ?? 0) === 0) return

        const fallbackAssistantIds = buildResourceOwnerFallbackIds(displayedAssistantIds, assistantId)
        const result = await deleteTopicsByAssistantId(assistantId)
        if (activeAssistantId === assistantId) {
          if (onActiveAssistantDeleted) {
            await onActiveAssistantDeleted(assistantId, fallbackAssistantIds, 'emptied')
          } else {
            onClearActiveTopic?.(assistantId)
          }
        }
        await refreshTopics()

        toast.success(t('assistants.clear.success_title', { count: result.deletedCount }))
      } catch (err) {
        logger.error('Failed to clear assistant topics from classic-layout rail', { assistantId, err })
        toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        setClearingTopicsAssistantId(null)
      }
    },
    [
      clearingTopicsAssistantId,
      activeAssistantId,
      deleteTopicsByAssistantId,
      deletingAssistantId,
      displayedAssistantIds,
      onActiveAssistantDeleted,
      onClearActiveTopic,
      refreshTopics,
      t,
      topicCountByAssistantId
    ]
  )

  const handleDeleteAssistant = useCallback(
    async (assistantId: string) => {
      if (deletingAssistantId) return

      setDeletingAssistantId(assistantId)
      try {
        const confirmed = await popup.confirm({
          title: t('assistants.delete.title'),
          content: t('assistants.delete.content'),
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        const fallbackAssistantIds = buildResourceOwnerFallbackIds(displayedAssistantIds, assistantId)
        const result = await deleteAssistant(assistantId, { deleteTopics: true })
        closeConversationTabs('assistants', result.deletedTopicIds ?? [])
        if (activeAssistantId === assistantId) {
          await onActiveAssistantDeleted?.(assistantId, fallbackAssistantIds, 'deleted')
        }

        await refreshAssistants()
        await refreshTopics()
        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete assistant from classic-layout rail', { assistantId, err })
        toast.error(formatErrorMessageWithPrefix(err, t('common.delete_failed')))
      } finally {
        setDeletingAssistantId(null)
      }
    },
    [
      activeAssistantId,
      closeConversationTabs,
      deleteAssistant,
      deletingAssistantId,
      displayedAssistantIds,
      onActiveAssistantDeleted,
      refreshAssistants,
      refreshTopics,
      t
    ]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem): ResolvedAction[] => {
      if (item.id === DEFAULT_ASSISTANT_ENTITY_ID) {
        return [
          buildResolvedIconTypeMenuAction(
            ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID,
            t('assistants.icon.type'),
            <Smile size={14} />,
            30,
            assistantIconType,
            t
          ),
          buildResolvedResourceEntityMenuAction({
            id: ASSISTANT_ENTITY_TOGGLE_GROUPING_ACTION_ID,
            label: isGroupGrouping ? t('assistants.groups.ungroup') : t('assistants.groups.group_by'),
            icon: <Tags size={14} />,
            order: 35
          })
        ]
      }
      const pinned = assistantPinnedIdSet.has(item.id)

      return [
        buildResolvedResourceEntityMenuAction({
          id: ASSISTANT_ENTITY_EDIT_ACTION_ID,
          label: t('assistants.edit.title'),
          icon: <Edit3 size={14} />,
          order: 10
        }),
        buildResolvedResourceEntityMenuAction({
          id: ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID,
          label: pinned ? t('assistants.unpin.title') : t('assistants.pin.title'),
          icon: pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />,
          order: 20,
          availability: { visible: true, enabled: !isAssistantPinActionDisabled }
        }),
        buildResolvedResourceEntityMenuAction({
          id: ASSISTANT_ENTITY_CLEAR_TOPICS_ACTION_ID,
          label: t('assistants.clear.menu_title'),
          icon: <BrushCleaning size={14} />,
          order: 25,
          availability: { visible: true, enabled: !clearingTopicsAssistantId && !deletingAssistantId }
        }),
        buildResolvedIconTypeMenuAction(
          ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID,
          t('assistants.icon.type'),
          <Smile size={14} />,
          30,
          assistantIconType,
          t
        ),
        buildResolvedResourceEntityMenuAction({
          id: ASSISTANT_ENTITY_TOGGLE_GROUPING_ACTION_ID,
          label: isGroupGrouping ? t('assistants.groups.ungroup') : t('assistants.groups.group_by'),
          icon: <Tags size={14} />,
          order: 35
        }),
        buildResolvedResourceEntityMenuAction({
          id: ASSISTANT_ENTITY_DELETE_ACTION_ID,
          label: t('assistants.delete.title'),
          icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
          group: 'danger',
          order: 30,
          danger: true,
          availability: { visible: true, enabled: deletingAssistantId === null }
        })
      ]
    },
    [
      assistantIconType,
      assistantPinnedIdSet,
      clearingTopicsAssistantId,
      deletingAssistantId,
      isAssistantPinActionDisabled,
      isGroupGrouping,
      t
    ]
  )

  const handleContextMenuAction = useCallback(
    (item: ResourceEntityRailItem, action: ResolvedAction) => {
      if (item.id === DEFAULT_ASSISTANT_ENTITY_ID && !action.id.startsWith(ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID)) {
        if (action.id === ASSISTANT_ENTITY_TOGGLE_GROUPING_ACTION_ID) {
          void setAssistantSortType(isGroupGrouping ? 'list' : 'tags')
        }
        return
      }
      if (action.id === ASSISTANT_ENTITY_EDIT_ACTION_ID) {
        openAssistantEditor(item.id)
        return
      }
      if (action.id === ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID) {
        void handleToggleAssistantPin(item.id)
        return
      }
      if (action.id === ASSISTANT_ENTITY_CLEAR_TOPICS_ACTION_ID) {
        void handleClearAssistantTopics(item.id)
        return
      }
      if (action.id === ASSISTANT_ENTITY_TOGGLE_GROUPING_ACTION_ID) {
        void setAssistantSortType(isGroupGrouping ? 'list' : 'tags')
        return
      }
      if (action.id.startsWith(`${ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID}.`)) {
        void setAssistantIconType(action.id.slice(ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID.length + 1) as AssistantIconType)
        return
      }
      if (action.id === ASSISTANT_ENTITY_DELETE_ACTION_ID) {
        void handleDeleteAssistant(item.id)
      }
    },
    [
      handleDeleteAssistant,
      handleClearAssistantTopics,
      handleToggleAssistantPin,
      isGroupGrouping,
      openAssistantEditor,
      setAssistantIconType,
      setAssistantSortType
    ]
  )

  return (
    <>
      <ResourceEntityRail
        variant="assistant"
        items={items}
        selectedId={hasActiveResourceMenuItem ? null : selectedId}
        selectedClickId={hasActiveResourceMenuItem ? null : activeAssistantId}
        status={listStatus}
        ariaLabel={t('assistants.abbr')}
        defaultGroupLabel={t('assistants.abbr')}
        groupByGroup={isGroupGrouping}
        addIcon={<Plus />}
        addLabel={t('chat.add.assistant.title')}
        historyRecordsActive={historyRecordsActive}
        onAdd={onAddAssistant ?? (() => onCreateTopic(null))}
        headerActions={
          <TopicListOptionsMenu
            historyRecordsActive={historyRecordsActive}
            manageAssistantsActive={manageAssistantsMenuItem?.active}
            mode={topicDisplayMode}
            onChange={(nextMode) => void setTopicDisplayMode(nextMode)}
            onManageAssistants={manageAssistantsMenuItem?.onSelect}
            onOpenHistoryRecords={onOpenHistoryRecords}
            onSortByChange={(nextSortBy) => void setTopicSortBy(nextSortBy)}
            sortBy={topicSortBy}
          />
        }
        onSelect={handleSelect}
        onSelectedClick={() => void onSelectedAssistantClick?.()}
        // Reorder persists the global assistant `orderKey`; grouped sections use Group.orderKey.
        // Disable assistant reorder while grouped because it cannot change group ordering.
        onReorder={isGroupGrouping ? undefined : handleReorder}
        getContextMenuActions={getContextMenuActions}
        onContextMenuAction={handleContextMenuAction}
      />
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
        onSaved={refreshAssistants}
      />
    </>
  )
}
