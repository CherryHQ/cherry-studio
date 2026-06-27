import { dataApiService } from '@data/DataApiService'
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
import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useAssistantsApi } from '@renderer/hooks/useAssistant'
import { usePins } from '@renderer/hooks/usePins'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import {
  type AssistantGroupAction,
  type AssistantGroupActionContext,
  executeAssistantGroupAction,
  resolveAssistantGroupActions
} from '@renderer/pages/home/Tabs/components/assistantGroupActions'
import { sortTopicsForDisplayGroups } from '@renderer/pages/home/Tabs/components/topicsHelpers'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { Bot, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AssistantResourceList')

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
    (entityTopics: Topic[]) => sortTopicsForDisplayGroups(entityTopics, { mode: 'time', now: new Date() }),
    []
  )
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
    getResourceParentId: (topic) => topic.assistantId,
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

  const handleDeleteAssistantTopics = useCallback(
    async (assistantId: string) => {
      if (deletingAssistantId) return

      const targetTopics = topics.filter((topic) => topic.assistantId === assistantId)
      if (targetTopics.length === 0) return

      setDeletingAssistantId(assistantId)
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
        if (activeAssistantId === assistantId) {
          closeRightPane?.()
          await onStartDraftAssistant(assistantId)
        }

        window.toast.success(t('chat.topics.manage.delete.success', { count: result.deletedCount }))
        await refreshTopics()
      } catch (err) {
        logger.error('Failed to delete assistant topics from old-view rail', { assistantId, err })
        window.toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        setDeletingAssistantId(null)
      }
    },
    [
      activeAssistantId,
      closeRightPane,
      deleteTopicsByAssistantId,
      deletingAssistantId,
      onStartDraftAssistant,
      refreshTopics,
      t,
      topics
    ]
  )

  const buildActionContext = useCallback(
    (assistantId: string): AssistantGroupActionContext => ({
      assistantId,
      deleteTopicsDisabled: deletingAssistantId !== null || !topics.some((topic) => topic.assistantId === assistantId),
      disabled: isAssistantPinActionDisabled,
      onDeleteAllTopics: handleDeleteAssistantTopics,
      onEdit: openAssistantEditor,
      onTogglePin: handleToggleAssistantPin,
      pinned: assistantPinnedIdSet.has(assistantId),
      t
    }),
    [
      assistantPinnedIdSet,
      deletingAssistantId,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      openAssistantEditor,
      t,
      topics
    ]
  )

  const getContextMenuActions = useCallback(
    (item: ResourceEntityRailItem) => resolveAssistantGroupActions(buildActionContext(item.id)),
    [buildActionContext]
  )

  const handleContextMenuAction = useCallback(
    (item: ResourceEntityRailItem, action: AssistantGroupAction) => {
      void executeAssistantGroupAction(action, buildActionContext(item.id))
    },
    [buildActionContext]
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
