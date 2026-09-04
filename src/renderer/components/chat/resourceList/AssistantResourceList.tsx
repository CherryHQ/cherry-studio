import { Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
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
import { useMutation } from '@renderer/data/hooks/useDataApi'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { useGroupReorder, useGroups } from '@renderer/hooks/useGroups'
import { usePins } from '@renderer/hooks/usePins'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import { popup } from '@renderer/services/popup'
import {
  restoreRecycleBinItems,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { BrushCleaning, Edit3, PinIcon, PinOffIcon, Plus, Smile, Tags, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildResolvedIconTypeMenuAction,
  buildResolvedResourceEntityMenuAction,
  renderAssistantEntityIcon,
  ResourceList,
  TopicListOptionsMenu
} from './base'
import { ResourceEntityRail, type ResourceEntityRailItem } from './ResourceEntityRail'
import { type ResourceEntityRailReorderAnchor, useResourceEntityRail } from './useResourceEntityRail'

const logger = loggerService.withContext('AssistantResourceList')

const ASSISTANT_ENTITY_EDIT_ACTION_ID = 'assistant-entity.edit'
const ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID = 'assistant-entity.toggle-pin'
const ASSISTANT_ENTITY_CLEAR_TOPICS_ACTION_ID = 'assistant-entity.clear-topics'
const ASSISTANT_ENTITY_TOGGLE_GROUPING_ACTION_ID = 'assistant-entity.toggle-grouping'
const ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID = 'assistant-entity.icon-type'
const ASSISTANT_ENTITY_DELETE_ACTION_ID = 'assistant-entity.delete'
const ASSISTANT_ENTITY_TOGGLE_SIDEBAR_ACTION_ID = 'assistant-entity.toggle-sidebar'
const UNLINKED_ASSISTANT_ENTITY_ID = 'assistant-entity:unlinked'

type AssistantResourceListProps = {
  activeAssistantId?: string | null
  activeTopicId?: string | null
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  manageAssistantsActive?: boolean
  assistantTopicsSource: AssistantTopicsSource
  onAddAssistant?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onManageAssistants?: () => void | Promise<void>
  onSelectTopic: (topic: Topic) => void | boolean
  onClearActiveTopic: () => void
  onSelectedAssistantClick?: () => void | Promise<void>
  onCreateTopic: (assistantId: string | null) => Promise<Topic | null>
  /**
   * Called after the currently-active assistant is deleted so the classic-layout page
   * can settle (select the latest remaining topic / fall back). This is the old
   * layout's reset and is distinct from `onCreateTopic`.
   */
  onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
}

export function AssistantResourceList({
  activeAssistantId,
  activeTopicId,
  dataEnabled = true,
  historyRecordsActive = false,
  manageAssistantsActive = false,
  assistantTopicsSource,
  onAddAssistant,
  onOpenHistoryRecords,
  onManageAssistants,
  onSelectTopic,
  onClearActiveTopic,
  onSelectedAssistantClick,
  onCreateTopic,
  onActiveAssistantDeleted
}: AssistantResourceListProps) {
  const { t } = useTranslation()
  const [assistantSortType, setAssistantSortType] = usePreference('assistant.tab.sort_type')
  const [assistantIconType, setAssistantIconType] = usePreference('assistant.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [collapsedGroupIds, setCollapsedGroupIds] = usePersistCache('ui.assistant.entity_rail.expansion')
  // Keep the persisted legacy token (`tags`) for preference compatibility; runtime grouping uses Group rows.
  const isGroupGrouping = assistantSortType === 'tags'
  const {
    assistants,
    hasLoaded: hasAssistantsLoaded,
    isLoading: isAssistantsLoading,
    error: assistantsError,
    refetch: refreshAssistants
  } = useAssistantsApi()
  const {
    groups: assistantGroups,
    isLoading: isAssistantGroupsLoading,
    error: assistantGroupsError
  } = useGroups('assistant', { enabled: dataEnabled && isGroupGrouping })
  const { reorderGroup: reorderAssistantGroup } = useGroupReorder()
  const {
    topics: apiTopics,
    rendererTopics,
    isLoadingAll: isTopicsLoadingAll,
    isFullyLoaded: isTopicsFullyLoaded,
    isRefreshing: isTopicsRefreshing,
    error: topicsError,
    loadLatestTopic
  } = assistantTopicsSource
  const { isLoading: isTopicPinsLoading, pinnedIds: topicPinnedIds } = usePins('topic', { enabled: dataEnabled })
  const {
    isLoading: isAssistantPinsLoading,
    isMutating: isAssistantPinsMutating,
    isRefreshing: isAssistantPinsRefreshing,
    pinnedIds: assistantPinnedIds,
    togglePin: toggleAssistantPin
  } = usePins('assistant', { enabled: dataEnabled })
  const closeConversationTabs = useCloseConversationTabs()
  const { deleteAssistant, restoreAssistant } = useAssistantMutations()
  const { deleteTopicsByAssistantId, refreshTopics, restoreTopic } = useTopicMutations()
  const topicPinnedIdSet = useMemo(() => new Set(topicPinnedIds), [topicPinnedIds])
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null)
  const [clearingTopicsAssistantId, setClearingTopicsAssistantId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const assistantPinnedIdSet = useMemo(() => new Set(assistantPinnedIds), [assistantPinnedIds])
  const assistantIdSet = useMemo(() => new Set(assistants.map((assistant) => assistant.id)), [assistants])
  const { assistantFavoriteIds: sidebarAssistantFavoriteIds, toggleAssistant, removeAssistant } = useSidebarFavorites()
  const sidebarAssistantFavoriteIdSet = useMemo(
    () => new Set(sidebarAssistantFavoriteIds),
    [sidebarAssistantFavoriteIds]
  )
  const assistantGroupById = useMemo(
    () => new Map(assistantGroups.map((group) => [group.id, group] as const)),
    [assistantGroups]
  )
  const isAssistantPinActionDisabled = isAssistantPinsLoading || isAssistantPinsRefreshing || isAssistantPinsMutating
  // The shared mapped list carries `pinned: false`, so only pinned rows need a copy.
  const topics = useMemo(
    () => rendererTopics.map((topic) => (topicPinnedIdSet.has(topic.id) ? { ...topic, pinned: true } : topic)),
    [rendererTopics, topicPinnedIdSet]
  )
  const topicsRef = useRef(topics)
  useEffect(() => {
    topicsRef.current = topics
  }, [topics])

  const createTopicForAssistant = useCallback(
    (assistantId: string) => onCreateTopic(assistantId === UNLINKED_ASSISTANT_ENTITY_ID ? null : assistantId),
    [onCreateTopic]
  )
  const handleActivationError = useCallback(
    (error: unknown) => {
      logger.error('Failed to activate assistant resource from classic-layout rail', { error })
      toast.error(formatErrorMessageWithPrefix(error, t('common.error')))
    },
    [t]
  )
  const handleCreateTopic = useCallback(
    async (assistantId: string) => {
      try {
        const topic = await createTopicForAssistant(assistantId)
        if (topic) onSelectTopic(topic)
      } catch (error) {
        handleActivationError(error)
      }
    },
    [createTopicForAssistant, handleActivationError, onSelectTopic]
  )
  const getAssistantEntityId = useCallback(
    (assistantId: string | null | undefined) =>
      assistantId && (!hasAssistantsLoaded || assistantIdSet.has(assistantId))
        ? assistantId
        : UNLINKED_ASSISTANT_ENTITY_ID,
    [assistantIdSet, hasAssistantsLoaded]
  )
  const hasUnlinkedAssistantTopics = useMemo(
    () => apiTopics.some((topic) => getAssistantEntityId(topic.assistantId) === UNLINKED_ASSISTANT_ENTITY_ID),
    [apiTopics, getAssistantEntityId]
  )
  const entities = useMemo<ResourceEntityRailItem[]>(() => {
    const unlinkedAssistantEntity: ResourceEntityRailItem[] = hasUnlinkedAssistantTopics
      ? [
          {
            id: UNLINKED_ASSISTANT_ENTITY_ID,
            name: t('chat.topics.group.unknown_assistant'),
            tooltip: t('chat.topics.group.unknown_assistant_tip'),
            reorderable: false
            // No "new topic" action: this is only a display bucket for topics whose
            // assistant is absent or no longer available.
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
                <NewConversationIcon className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )
        }
      }),
      ...unlinkedAssistantEntity
    ]
  }, [
    assistantGroupById,
    assistantIconType,
    assistants,
    assistantPinnedIdSet,
    defaultModelId,
    handleCreateTopic,
    hasUnlinkedAssistantTopics,
    t
  ])

  const getTopicAssistantId = useCallback(
    (topic: Topic) => getAssistantEntityId(topic.assistantId),
    [getAssistantEntityId]
  )
  const loadLatestTopicForAssistant = useCallback(
    async (assistantId: string) => {
      const topic = await loadLatestTopic(assistantId === UNLINKED_ASSISTANT_ENTITY_ID ? null : assistantId)
      return topic ? mapApiTopicToRendererTopic(topic) : null
    },
    [loadLatestTopic]
  )
  const activeAssistantEntityId = getAssistantEntityId(activeAssistantId)
  const { trigger: reorderAssistantOrder } = useMutation('PATCH', '/assistants/:id/order', { refresh: ['/assistants'] })
  const reorderAssistant = useCallback(
    async (assistantId: string, anchor: ResourceEntityRailReorderAnchor) => {
      if (assistantId === UNLINKED_ASSISTANT_ENTITY_ID) return

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
  const handleGroupReorder = useCallback(
    async (groupId: string, anchor: ResourceEntityRailReorderAnchor) => {
      try {
        await reorderAssistantGroup(groupId, anchor)
      } catch (error) {
        logger.error('Failed to reorder assistant groups in classic-layout rail', { groupId, error })
        toast.error(formatErrorMessageWithPrefix(error, t('assistants.reorder.error.failed')))
      }
    },
    [reorderAssistantGroup, t]
  )

  const { items, listStatus, selectedId, handleSelect, handleReorder } = useResourceEntityRail({
    entities,
    resources: topics,
    getResourceParentId: getTopicAssistantId,
    activeEntityId: activeAssistantEntityId,
    isLoading:
      isAssistantsLoading ||
      (isGroupGrouping && isAssistantGroupsLoading) ||
      isTopicsLoadingAll ||
      !isTopicsFullyLoaded ||
      isTopicPinsLoading,
    isError: !!(assistantsError || (isGroupGrouping && assistantGroupsError) || topicsError),
    onPickResource: onSelectTopic,
    loadResourceForEntity: loadLatestTopicForAssistant,
    onCreateResource: createTopicForAssistant,
    onActivationError: handleActivationError,
    reorder: reorderAssistant,
    refetchEntities: refreshAssistants,
    onReorderError: handleReorderError
  })

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

      const targetTopics = topicsRef.current.filter((topic) => topic.assistantId === assistantId)
      if (targetTopics.length === 0) return

      setClearingTopicsAssistantId(assistantId)
      try {
        const confirmed = await popup.confirm({
          title: t('recycle_bin.move.confirm_title'),
          okText: t('recycle_bin.move.confirm_action'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        // Re-validate against the latest topics after the confirm dialog: the list may
        // have changed while it was open, and TopicService.deleteByAssistantId() has no
        // at-least-one guard of its own, so bail out if nothing is left to clear.
        const latestTargetTopicIds = new Set(
          topicsRef.current.filter((topic) => topic.assistantId === assistantId).map((topic) => topic.id)
        )
        if (latestTargetTopicIds.size === 0) return

        const result = await deleteTopicsByAssistantId(assistantId)
        if (result.deletedIds.length === 0) {
          await refreshTopics().catch((err) => {
            logger.warn('Failed to refresh Topics after stale clear from classic-layout rail', { assistantId, err })
          })
          toast.info(t('recycle_bin.already_moved'))
          return
        }

        const deletedIds = [...result.deletedIds]
        showRecycleBinBatchUndo({
          itemCount: deletedIds.length,
          onUndo: () =>
            restoreRecycleBinItems({
              ids: deletedIds,
              restore: restoreTopic,
              getActive: (id) => dataApiService.get(`/topics/${id}`),
              refresh: refreshTopics
            })
        })

        try {
          await refreshTopics()
        } catch (err) {
          logger.warn('Failed to refresh Topics after clear from classic-layout rail', { assistantId, err })
        }
        if (activeAssistantId === assistantId) {
          try {
            const nextTopic = await loadLatestTopic()
            if (nextTopic) onSelectTopic(mapApiTopicToRendererTopic(nextTopic))
            else onClearActiveTopic()
          } catch (err) {
            logger.warn('Failed to reconcile active Topic after clear from classic-layout rail', { assistantId, err })
          }
        }
      } catch (err) {
        logger.error('Failed to clear assistant topics from classic-layout rail', { assistantId, err })
        toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        setClearingTopicsAssistantId(null)
      }
    },
    [
      clearingTopicsAssistantId,
      deleteTopicsByAssistantId,
      deletingAssistantId,
      activeAssistantId,
      loadLatestTopic,
      onClearActiveTopic,
      onSelectTopic,
      refreshTopics,
      restoreTopic,
      t
    ]
  )

  const refreshAfterRestore = useCallback(async () => {
    const outcomes = await Promise.allSettled([refreshAssistants(), refreshTopics()])
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('Failed to refresh Assistant resources after restore from classic-layout rail', {
          err: outcome.reason
        })
      }
    }
  }, [refreshAssistants, refreshTopics])

  const handleDeleteAssistant = useCallback(
    async (assistantId: string) => {
      if (deletingAssistantId) return

      const assistantName = assistants.find((assistant) => assistant.id === assistantId)?.name ?? t('common.unnamed')
      const performDelete = async (deleteTopics: boolean) => {
        setDeletingAssistantId(assistantId)
        try {
          let result
          try {
            result = await deleteAssistant(assistantId, { deleteTopics })
          } catch (err) {
            if (!isDataApiNotFoundError(err)) throw err
            await Promise.allSettled([refreshAssistants(), refreshTopics()])
            toast.info(t('recycle_bin.already_moved'))
            return
          }
          if (!result.deleted) {
            await Promise.allSettled([refreshAssistants(), refreshTopics()])
            toast.info(t('recycle_bin.already_moved'))
            return
          }
          const deletedTopicIds = result.deletedTopicIds ?? []
          if (deletedTopicIds.length > 0) closeConversationTabs('assistants', deletedTopicIds)
          if (activeTopicId && deletedTopicIds.includes(activeTopicId)) {
            try {
              await onActiveAssistantDeleted?.(assistantId)
            } catch (err) {
              logger.warn('Failed to reconcile active Assistant after deletion from classic-layout rail', {
                assistantId,
                err
              })
            }
          }

          try {
            await refreshAssistants()
          } catch (err) {
            logger.warn('Failed to refresh Assistants after deletion from classic-layout rail', { assistantId, err })
          }
          try {
            await refreshTopics()
          } catch (err) {
            logger.warn('Failed to refresh Topics after Assistant deletion from classic-layout rail', {
              assistantId,
              err
            })
          }
          showRecycleBinUndo({
            itemName: assistantName,
            onUndo: async () => {
              try {
                await restoreAssistant(assistantId)
              } catch (err) {
                if (!isDataApiNotFoundError(err)) throw err
                await refreshAfterRestore()
                try {
                  await dataApiService.get(`/assistants/${assistantId}`)
                  return
                } catch {
                  throw err
                }
              }
              await refreshAfterRestore()
            }
          })
        } catch (err) {
          logger.error('Failed to delete assistant from classic-layout rail', { assistantId, err })
          throw err
        } finally {
          setDeletingAssistantId(null)
        }
      }

      await deleteConversationOwnerPopup.show({ type: 'assistant', action: performDelete })
    },
    [
      activeTopicId,
      assistants,
      closeConversationTabs,
      deleteAssistant,
      deletingAssistantId,
      onActiveAssistantDeleted,
      refreshAfterRestore,
      refreshAssistants,
      refreshTopics,
      restoreAssistant,
      t
    ]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem): ResolvedAction[] => {
      if (item.id === UNLINKED_ASSISTANT_ENTITY_ID) return []

      const pinned = assistantPinnedIdSet.has(item.id)
      const sidebarPinned = sidebarAssistantFavoriteIdSet.has(item.id)

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
          id: ASSISTANT_ENTITY_TOGGLE_SIDEBAR_ACTION_ID,
          label: sidebarPinned ? t('launchpad.unpin_from_sidebar') : t('launchpad.pin_to_sidebar'),
          icon: sidebarPinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />,
          order: 22
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
      sidebarAssistantFavoriteIdSet,
      t
    ]
  )

  const handleContextMenuAction = useCallback(
    (item: ResourceEntityRailItem, action: ResolvedAction) => {
      if (action.id === ASSISTANT_ENTITY_EDIT_ACTION_ID) {
        openAssistantEditor(item.id)
        return
      }
      if (action.id === ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID) {
        void handleToggleAssistantPin(item.id)
        return
      }
      if (action.id === ASSISTANT_ENTITY_TOGGLE_SIDEBAR_ACTION_ID) {
        if (sidebarAssistantFavoriteIdSet.has(item.id)) removeAssistant(item.id)
        else toggleAssistant(item.id)
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
      removeAssistant,
      setAssistantIconType,
      setAssistantSortType,
      sidebarAssistantFavoriteIdSet,
      toggleAssistant
    ]
  )

  return (
    <>
      <ResourceEntityRail
        variant="assistant"
        items={items}
        selectedId={selectedId}
        selectedClickId={manageAssistantsActive ? null : activeAssistantEntityId}
        selectionSuppressed={manageAssistantsActive || historyRecordsActive}
        status={listStatus}
        ariaLabel={t('assistants.abbr')}
        defaultGroupLabel={t('assistants.abbr')}
        groupByGroup={isGroupGrouping}
        collapsedState={collapsedGroupIds}
        addIcon={<Plus />}
        addLabel={t('chat.add.assistant.title')}
        onAdd={onAddAssistant ?? (() => handleCreateTopic(UNLINKED_ASSISTANT_ENTITY_ID))}
        headerActions={
          <TopicListOptionsMenu
            historyRecordsActive={historyRecordsActive}
            manageAssistantsActive={manageAssistantsActive}
            mode={topicDisplayMode}
            onChange={(nextMode) => void setTopicDisplayMode(nextMode)}
            onManageAssistants={onManageAssistants}
            onOpenHistoryRecords={onOpenHistoryRecords}
          />
        }
        onSelect={handleSelect}
        onSelectedClick={() => void onSelectedAssistantClick?.()}
        onCollapsedStateChange={setCollapsedGroupIds}
        onReorder={isGroupGrouping ? undefined : handleReorder}
        onGroupReorder={isGroupGrouping ? handleGroupReorder : undefined}
        reorderEnabled={isTopicsFullyLoaded && !isTopicsLoadingAll && !isTopicsRefreshing}
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
