import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
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
import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { usePins } from '@renderer/hooks/usePins'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { Bot, Edit3, PinIcon, PinOffIcon, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { sortResourceItemsByPinnedTime } from './resourceEntitySort'

const logger = loggerService.withContext('AssistantResourceList')

const ASSISTANT_ENTITY_EDIT_ACTION_ID = 'assistant-entity.edit'
const ASSISTANT_ENTITY_TOGGLE_PIN_ACTION_ID = 'assistant-entity.toggle-pin'
const ASSISTANT_ENTITY_DELETE_ACTION_ID = 'assistant-entity.delete'

type AssistantResourceListProps = {
  activeAssistantId?: string | null
  onAddAssistant?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSelectTopic: (topic: Topic) => void | boolean
  onStartDraftAssistant: (assistantId: string | null) => void | Promise<void>
}

export function AssistantResourceList({
  activeAssistantId,
  onAddAssistant,
  onOpenHistoryRecords,
  onSelectTopic,
  onStartDraftAssistant
}: AssistantResourceListProps) {
  const { t } = useTranslation()
  const closeRightPane = useOptionalShellActions()?.close
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
      assistants.map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        orderKey: assistant.orderKey,
        pinned: assistantPinnedIdSet.has(assistant.id),
        icon: assistant.emoji ? (
          <EmojiIcon emoji={assistant.emoji} size={24} fontSize={14} className="mr-0" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-sidebar-accent">
            <Bot size={14} />
          </span>
        )
      })),
    [assistants, assistantPinnedIdSet]
  )

  const sortTopicsForEntity = useCallback(
    (entityTopics: Topic[]) => sortResourceItemsByPinnedTime(entityTopics, new Date()),
    []
  )
  const getTopicAssistantId = useCallback((topic: Topic) => topic.assistantId, [])
  const reorderAssistant = useCallback(async (assistantId: string, anchor: ResourceEntityRailReorderAnchor) => {
    await dataApiService.patch(`/assistants/${assistantId}/order`, { body: anchor })
  }, [])
  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder assistant old-view rail', { error })
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
        logger.error('Failed to toggle assistant pin from old-view rail', { assistantId, err })
        window.toast.error(t('common.error'))
      }
    },
    [isAssistantPinActionDisabled, refreshAssistants, t, toggleAssistantPin]
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

        await deleteTopicsByAssistantId(assistantId)
        await deleteAssistant(assistantId)
        if (activeAssistantId === assistantId) {
          closeRightPane?.()
          await onStartDraftAssistant(null)
        }

        await refreshAssistants()
        await refreshTopics()
        window.toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete assistant from old-view rail', { assistantId, err })
        window.toast.error(formatErrorMessageWithPrefix(err, t('common.delete_failed')))
      } finally {
        setDeletingAssistantId(null)
      }
    },
    [
      activeAssistantId,
      closeRightPane,
      deleteAssistant,
      deleteTopicsByAssistantId,
      deletingAssistantId,
      onStartDraftAssistant,
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
    [assistantPinnedIdSet, deletingAssistantId, isAssistantPinActionDisabled, t]
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
      if (action.id === ASSISTANT_ENTITY_DELETE_ACTION_ID) {
        void handleDeleteAssistant(item.id)
      }
    },
    [handleDeleteAssistant, handleToggleAssistantPin, openAssistantEditor]
  )

  return (
    <>
      <ResourceEntityRail
        variant="assistant"
        items={items}
        selectedId={selectedId}
        status={listStatus}
        ariaLabel={t('assistants.abbr')}
        defaultGroupLabel={t('assistants.abbr')}
        addIcon={<Plus />}
        addLabel={t('chat.add.assistant.title')}
        createItemLabel={t('chat.conversation.new')}
        onAdd={onAddAssistant ?? (() => onStartDraftAssistant(null))}
        onOpenHistoryRecords={onOpenHistoryRecords}
        onCreateItem={(item) => onStartDraftAssistant(item.id)}
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
        onSaved={refreshAssistants}
      />
    </>
  )
}
