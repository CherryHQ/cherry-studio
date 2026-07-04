import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ResourceEditDialogHost, type ResourceEditDialogTarget } from '@renderer/components/resource/dialogs'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { usePins } from '@renderer/hooks/usePins'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { Bot, BrushCleaning, Check, Edit3, PinIcon, PinOffIcon, Plus, Smile, Tags, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationResourceMenuItem } from '../ConversationResourceMenu'
import { TopicListOptionsMenu } from '../TopicListOptionsMenu'
import { ResourceEntityRail, type ResourceEntityRailItem } from './ResourceEntityRail'
import { sortResourceItemsByPinnedTime } from './resourceEntitySort'
import { type ResourceEntityRailReorderAnchor, useResourceEntityRail } from './useResourceEntityRail'

const logger = loggerService.withContext('AssistantResourceList')

const ASSISTANT_ENTITY_EDIT_ACTION_ID = 'assistant-entity.edit'
const ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID = 'assistant-entity.toggle-pin'
const ASSISTANT_ENTITY_CLEAR_TOPICS_ACTION_ID = 'assistant-entity.clear-topics'
const ASSISTANT_ENTITY_TOGGLE_TAG_GROUPING_ACTION_ID = 'assistant-entity.toggle-tag-grouping'
const ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID = 'assistant-entity.icon-type'
const ASSISTANT_ENTITY_DELETE_ACTION_ID = 'assistant-entity.delete'
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

type AssistantResourceListProps = {
  activeAssistantId?: string | null
  onAddAssistant?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSelectTopic: (topic: Topic) => void | boolean
  onSelectedAssistantClick?: () => void | Promise<void>
  onStartDraftAssistant: (assistantId: string | null) => void | Promise<void>
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  /**
   * Called after the currently-active assistant is deleted so the classic-layout page
   * can settle (select the latest remaining topic / fall back). This is the old
   * layout's reset and is distinct from `onStartDraftAssistant`.
   */
  onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
}

export function AssistantResourceList({
  activeAssistantId,
  onAddAssistant,
  onOpenHistoryRecords,
  onSelectTopic,
  onSelectedAssistantClick,
  onStartDraftAssistant,
  resourceMenuItems,
  onActiveAssistantDeleted
}: AssistantResourceListProps) {
  const { t } = useTranslation()
  const [assistantSortType, setAssistantSortType] = usePreference('assistant.tab.sort_type')
  const [assistantIconType, setAssistantIconType] = usePreference('assistant.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const isTagGrouping = assistantSortType === 'tags'
  const manageAssistantsMenuItem = resourceMenuItems?.find((item) => item.id === 'assistant-resource-view')
  const {
    assistants,
    isLoading: isAssistantsLoading,
    error: assistantsError,
    refetch: refreshAssistants
  } = useAssistantsApi()
  const {
    topics: apiTopics,
    isLoadingAll: isTopicsLoadingAll,
    isFullyLoaded: isTopicsFullyLoaded,
    error: topicsError
  } = useAssistantTopicsSource()
  const { isLoading: isTopicPinsLoading, pinnedIds: topicPinnedIds } = usePins('topic')
  const {
    isLoading: isAssistantPinsLoading,
    isMutating: isAssistantPinsMutating,
    isRefreshing: isAssistantPinsRefreshing,
    pinnedIds: assistantPinnedIds,
    togglePin: toggleAssistantPin
  } = usePins('assistant')
  const { deleteAssistant } = useAssistantMutations()
  const { deleteTopicsByAssistantId, refreshTopics } = useTopicMutations()
  const topicPinnedIdSet = useMemo(() => new Set(topicPinnedIds), [topicPinnedIds])
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null)
  const [clearingTopicsAssistantId, setClearingTopicsAssistantId] = useState<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const assistantPinnedIdSet = useMemo(() => new Set(assistantPinnedIds), [assistantPinnedIds])
  const isAssistantPinActionDisabled = isAssistantPinsLoading || isAssistantPinsRefreshing || isAssistantPinsMutating
  const topics = useMemo(
    () =>
      apiTopics.map((apiTopic) => ({
        ...mapApiTopicToRendererTopic(apiTopic),
        pinned: topicPinnedIdSet.has(apiTopic.id)
      })),
    [apiTopics, topicPinnedIdSet]
  )

  const entities = useMemo<ResourceEntityRailItem[]>(
    () =>
      assistants.map((assistant) => {
        const modelAvatarModel = buildModelAvatarModel(
          assistant.modelId ?? defaultModelId,
          assistant.modelName ?? undefined
        )
        const icon =
          assistantIconType === 'none' ? undefined : assistantIconType === 'model' && modelAvatarModel ? (
            <ModelAvatar model={modelAvatarModel} size={24} />
          ) : assistant.emoji ? (
            <EmojiIcon emoji={assistant.emoji} size={24} fontSize={14} className="mr-0" />
          ) : (
            <span className="flex size-6 items-center justify-center rounded-full bg-sidebar-accent">
              <Bot size={14} />
            </span>
          )

        return {
          id: assistant.id,
          name: assistant.name,
          orderKey: assistant.orderKey,
          pinned: assistantPinnedIdSet.has(assistant.id),
          tag: assistant.tags?.[0]?.name,
          icon
        }
      }),
    [assistantIconType, assistants, assistantPinnedIdSet, defaultModelId]
  )

  const sortTopicsForEntity = useCallback(
    (entityTopics: Topic[]) => sortResourceItemsByPinnedTime(entityTopics, new Date()),
    []
  )
  const getTopicAssistantId = useCallback((topic: Topic) => topic.assistantId, [])
  const { trigger: reorderAssistantOrder } = useMutation('PATCH', '/assistants/:id/order', { refresh: ['/assistants'] })
  const reorderAssistant = useCallback(
    async (assistantId: string, anchor: ResourceEntityRailReorderAnchor) => {
      await reorderAssistantOrder({ params: { id: assistantId }, body: anchor })
    },
    [reorderAssistantOrder]
  )
  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder assistant classic-layout rail', { error })
      window.toast.error(formatErrorMessageWithPrefix(error, t('assistants.reorder.error.failed')))
    },
    [t]
  )

  const { items, listStatus, selectedId, handleSelect, handleReorder } = useResourceEntityRail({
    entities,
    resources: topics,
    getResourceParentId: getTopicAssistantId,
    activeEntityId: activeAssistantId,
    isLoading: isAssistantsLoading || isTopicsLoadingAll || !isTopicsFullyLoaded || isTopicPinsLoading,
    isError: !!(assistantsError || topicsError),
    sortResourcesForEntity: sortTopicsForEntity,
    onPickResource: onSelectTopic,
    onStartDraft: onStartDraftAssistant,
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
        window.toast.error(t('common.error'))
      }
    },
    [isAssistantPinActionDisabled, refreshAssistants, t, toggleAssistantPin]
  )

  const handleClearAssistantTopics = useCallback(
    async (assistantId: string) => {
      if (clearingTopicsAssistantId || deletingAssistantId) return

      const targetTopics = topics.filter((topic) => topic.assistantId === assistantId)
      if (targetTopics.length === 0) return

      const targetTopicIds = new Set(targetTopics.map((topic) => topic.id))
      const remainingTopics = topics.filter((topic) => !targetTopicIds.has(topic.id))
      if (remainingTopics.length === 0) {
        window.toast.error(t('chat.topics.manage.error.at_least_one'))
        return
      }

      setClearingTopicsAssistantId(assistantId)
      try {
        const confirmed = await window.modal.confirm({
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

        const result = await deleteTopicsByAssistantId(assistantId)
        const deletedIds = new Set(result.deletedIds)
        const actualRemainingTopics = topics.filter((topic) => !deletedIds.has(topic.id))
        if (activeAssistantId === assistantId && actualRemainingTopics.length > 0) {
          onSelectTopic(actualRemainingTopics[0])
        }

        void window.modal.success({
          title: t('assistants.clear.success_title', { count: result.deletedCount }),
          content: (
            <div className="space-y-1">
              <p>{t('assistants.clear.success_content.line1')}</p>
              <p>{t('assistants.clear.success_content.line2')}</p>
            </div>
          ),
          okText: t('common.i_know'),
          centered: true
        })
        await refreshTopics()
      } catch (err) {
        logger.error('Failed to clear assistant topics from classic-layout rail', { assistantId, err })
        window.toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        setClearingTopicsAssistantId(null)
      }
    },
    [
      activeAssistantId,
      clearingTopicsAssistantId,
      deleteTopicsByAssistantId,
      deletingAssistantId,
      onSelectTopic,
      refreshTopics,
      t,
      topics
    ]
  )

  const handleDeleteAssistant = useCallback(
    async (assistantId: string) => {
      if (deletingAssistantId) return

      setDeletingAssistantId(assistantId)
      try {
        const confirmed = await window.modal.confirm({
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

        await deleteAssistant(assistantId, { deleteTopics: true })
        if (activeAssistantId === assistantId) {
          await onActiveAssistantDeleted?.(assistantId)
        }

        await refreshAssistants()
        await refreshTopics()
        window.toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete assistant from classic-layout rail', { assistantId, err })
        window.toast.error(formatErrorMessageWithPrefix(err, t('common.delete_failed')))
      } finally {
        setDeletingAssistantId(null)
      }
    },
    [
      activeAssistantId,
      deleteAssistant,
      deletingAssistantId,
      onActiveAssistantDeleted,
      refreshAssistants,
      refreshTopics,
      t
    ]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem): ResolvedAction[] => {
      const pinned = assistantPinnedIdSet.has(item.id)

      return [
        {
          id: ASSISTANT_ENTITY_EDIT_ACTION_ID,
          label: t('assistants.edit.title'),
          icon: <Edit3 size={14} />,
          order: 10,
          danger: false,
          availability: { visible: true, enabled: true },
          children: []
        },
        {
          id: ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID,
          label: pinned ? t('assistants.unpin.title') : t('assistants.pin.title'),
          icon: pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />,
          order: 20,
          danger: false,
          availability: { visible: true, enabled: !isAssistantPinActionDisabled },
          children: []
        },
        {
          id: ASSISTANT_ENTITY_CLEAR_TOPICS_ACTION_ID,
          label: t('assistants.clear.menu_title'),
          icon: <BrushCleaning size={14} />,
          order: 25,
          danger: false,
          availability: { visible: true, enabled: !clearingTopicsAssistantId && !deletingAssistantId },
          children: []
        },
        {
          id: ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID,
          label: t('assistants.icon.type'),
          icon: <Smile size={14} />,
          order: 30,
          danger: false,
          availability: { visible: true, enabled: true },
          children: ASSISTANT_ICON_TYPE_OPTIONS.map((type) => ({
            id: `${ASSISTANT_ENTITY_ICON_TYPE_ACTION_ID}.${type}`,
            label: t(ASSISTANT_ICON_TYPE_LABEL_KEYS[type]),
            icon: assistantIconType === type ? <Check size={14} /> : <span className="block size-4" />,
            order: 0,
            danger: false,
            availability: { visible: true, enabled: true },
            children: []
          }))
        },
        {
          id: ASSISTANT_ENTITY_TOGGLE_TAG_GROUPING_ACTION_ID,
          label: isTagGrouping ? t('assistants.tags.ungroup') : t('assistants.tags.group_by'),
          icon: <Tags size={14} />,
          order: 35,
          danger: false,
          availability: { visible: true, enabled: true },
          children: []
        },
        {
          id: ASSISTANT_ENTITY_DELETE_ACTION_ID,
          label: t('assistants.delete.title'),
          icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
          group: 'danger',
          order: 30,
          danger: true,
          availability: { visible: true, enabled: deletingAssistantId === null },
          children: []
        }
      ]
    },
    [
      assistantIconType,
      assistantPinnedIdSet,
      clearingTopicsAssistantId,
      deletingAssistantId,
      isAssistantPinActionDisabled,
      isTagGrouping,
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
      if (action.id === ASSISTANT_ENTITY_CLEAR_TOPICS_ACTION_ID) {
        void handleClearAssistantTopics(item.id)
        return
      }
      if (action.id === ASSISTANT_ENTITY_TOGGLE_TAG_GROUPING_ACTION_ID) {
        void setAssistantSortType(isTagGrouping ? 'list' : 'tags')
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
      isTagGrouping,
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
        selectedId={selectedId}
        selectedClickId={activeAssistantId}
        status={listStatus}
        ariaLabel={t('assistants.abbr')}
        defaultGroupLabel={t('assistants.abbr')}
        groupByTag={isTagGrouping}
        addIcon={<Plus />}
        addLabel={t('chat.add.assistant.title')}
        onAdd={onAddAssistant ?? (() => onStartDraftAssistant(null))}
        headerActions={
          <TopicListOptionsMenu
            manageAssistantsActive={manageAssistantsMenuItem?.active}
            mode={topicDisplayMode}
            onChange={(nextMode) => void setTopicDisplayMode(nextMode)}
            onManageAssistants={manageAssistantsMenuItem?.onSelect}
            onOpenHistoryRecords={onOpenHistoryRecords}
          />
        }
        onSelect={handleSelect}
        onSelectedClick={() => void onSelectedAssistantClick?.()}
        onReorder={handleReorder}
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
