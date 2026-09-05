import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type {
  TopicActionContext,
  TopicExportMenuOptions
} from '@renderer/components/chat/actions/topicContextMenuActions'
import { renderAssistantEntityIcon } from '@renderer/components/chat/resourceList/base'
import { AssistantSelector } from '@renderer/components/resourceCatalog/selectors'
import { dataApiService } from '@renderer/data/DataApiService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@renderer/data/hooks/usePreference'
import { useClearTopicMessages } from '@renderer/hooks/chat/useClearTopicMessages'
import { createTopicActionContext, useTopicMenuPreset } from '@renderer/hooks/chat/useTopicMenuActions'
import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useOptimisticResourceName } from '@renderer/hooks/useOptimisticResourceName'
import { usePins } from '@renderer/hooks/usePins'
import {
  cancelTopicRenaming,
  finishTopicRenaming,
  getTopicMessages,
  mapApiTopicToRendererTopic,
  startTopicRenaming,
  useTopicMutations
} from '@renderer/hooks/useTopic'
import {
  restoreRecycleBinItem,
  restoreRecycleBinItems,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import type { Topic as RendererTopic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import { sortTopicsForDisplayGroups } from '@renderer/utils/chat/topicsHelpers'
import { getErrorMessage } from '@renderer/utils/error'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { Bot } from 'lucide-react'
import { type ReactElement, type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HistoryRecordsContent } from './components/HistoryRecordsContent'
import { HistorySourceFilterField } from './components/HistorySourceFilter'
import { HistoryActionContextMenu } from './components/HistoryTableParts'
import type { HistoryBulkDeleteResult, HistoryRecordDescriptor, HistoryRowActions } from './historyRecordsDescriptor'
import {
  ALL_SOURCE_ID,
  buildAssistantSources,
  findAdjacentHistoryRecordAfterBulkDelete,
  getTopicSourceId
} from './historyRecordsHelpers'
import type { HistoryBulkMoveTarget } from './historyRecordsTypes'
import { useHistoryRecordsController } from './useHistoryRecordsController'

const logger = loggerService.withContext('AssistantHistoryRecords')

type HistoryTopicItem = ApiTopic & { assistantId: string | undefined; pinned: boolean }

interface AssistantHistoryRecordsProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (topic: RendererTopic | null) => void
  toolbarLeading?: ReactNode
}

const AssistantHistoryRecords = ({
  activeRecordId,
  onClose,
  onRecordSelect,
  toolbarLeading
}: AssistantHistoryRecordsProps) => {
  const { t } = useTranslation()
  const clearTopicMessages = useClearTopicMessages()
  const [groupNow] = useState(() => new Date())
  const conversationNav = useConversationNavigation('assistants')

  const { topics: rawTopics, rendererTopics, isLoadingAll: isTopicsLoading, refetch } = useAssistantTopicsSource()
  const { assistants } = useAssistants()
  const [assistantIconType] = usePreference('assistant.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [renamingTopics] = useCache('topic.renaming')
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById, restoreTopic, batchUpdateTopics } = useTopicMutations()
  const [exportMenuOptions] = useMultiplePreferences({
    docx: 'data.export.menus.docx',
    image: 'data.export.menus.image',
    joplin: 'data.export.menus.joplin',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notion: 'data.export.menus.notion',
    obsidian: 'data.export.menus.obsidian',
    plain_text: 'data.export.menus.plain_text',
    siyuan: 'data.export.menus.siyuan',
    yuque: 'data.export.menus.yuque'
  })
  const { pinnedIds: topicPinnedIds, togglePin: toggleTopicPin } = usePins('topic')
  const { items: optimisticTopics, rename: renameTopicOptimistically } = useOptimisticResourceName(rawTopics)

  const topicPinnedIdSet = useMemo(() => new Set(topicPinnedIds), [topicPinnedIds])
  const isTopicPinned = useCallback((topicId: string) => topicPinnedIdSet.has(topicId), [topicPinnedIdSet])
  const renamingTopicIdSet = useMemo(
    () => new Set(Array.isArray(renamingTopics) ? renamingTopics : []),
    [renamingTopics]
  )
  const isTopicRenaming = useCallback((topicId: string) => renamingTopicIdSet.has(topicId), [renamingTopicIdSet])

  const topics = useMemo<HistoryTopicItem[]>(
    () =>
      optimisticTopics.map((topic) => ({ ...topic, assistantId: topic.assistantId, pinned: isTopicPinned(topic.id) })),
    [isTopicPinned, optimisticTopics]
  )
  const assistantById = useMemo(() => new Map(assistants.map((assistant) => [assistant.id, assistant])), [assistants])
  const assistantRankById = useMemo(
    () => new Map(assistants.map((assistant, index) => [assistant.id, index])),
    [assistants]
  )
  const unlinkedAssistantLabel = t('history.records.filter.unlinkedAssistant')

  const timeSortedTopics = useMemo(
    () => sortTopicsForDisplayGroups(topics, { mode: 'time', now: groupNow }),
    [groupNow, topics]
  )
  const assistantSortedTopics = useMemo(
    () => sortTopicsForDisplayGroups(topics, { assistantRankById, mode: 'assistant', now: groupNow }),
    [assistantRankById, groupNow, topics]
  )

  const optimisticTopicById = useMemo(
    () => new Map(optimisticTopics.map((topic) => [topic.id, topic])),
    [optimisticTopics]
  )
  // The shared mapped list carries `pinned: false`; copy only rows with an optimistic name or pin override.
  const rendererTopicById = useMemo(
    () =>
      new Map(
        rendererTopics.map((topic) => {
          const optimisticName = optimisticTopicById.get(topic.id)?.name
          const pinned = isTopicPinned(topic.id)
          return [
            topic.id,
            optimisticName !== topic.name || pinned ? { ...topic, name: optimisticName ?? topic.name, pinned } : topic
          ]
        })
      ),
    [isTopicPinned, optimisticTopicById, rendererTopics]
  )
  const getRendererTopic = useCallback(
    (topic: ApiTopic): RendererTopic =>
      rendererTopicById.get(topic.id) ?? { ...mapApiTopicToRendererTopic(topic), pinned: isTopicPinned(topic.id) },
    [isTopicPinned, rendererTopicById]
  )

  const assistantSources = useMemo(
    () => buildAssistantSources(topics, assistantById, assistantRankById, unlinkedAssistantLabel, t),
    [assistantById, assistantRankById, t, topics, unlinkedAssistantLabel]
  )
  const additionalAssistantSourceItems = useMemo(
    () =>
      assistantSources
        .filter((source) => source.id !== ALL_SOURCE_ID && !assistantById.has(source.id))
        .map((source) => ({
          id: source.id,
          name: source.label,
          editDisabled: true,
          pinDisabled: true
        })),
    [assistantById, assistantSources]
  )
  const bulkMoveTargets = useMemo<HistoryBulkMoveTarget[]>(
    () =>
      assistants.map((assistant) => ({
        id: assistant.id,
        label: assistant.name || t('common.unnamed'),
        icon: assistant.emoji ? <span className="text-sm leading-none">{assistant.emoji}</span> : <Bot size={14} />
      })),
    [assistants, t]
  )

  const handleTopicSelect = useCallback(
    (topic: ApiTopic) => {
      const title = topic.name || t('chat.default.topic.name')
      if (conversationNav.openConversationTab(topic.id, title, { forceNew: true })) return

      onRecordSelect?.(getRendererTopic(topic))
      onClose()
    },
    [conversationNav, getRendererTopic, onClose, onRecordSelect, t]
  )

  const updateTopic = useCallback(
    (topic: Pick<RendererTopic, 'id' | 'isNameManuallyEdited' | 'name'>) =>
      patchTopic(topic.id, { name: topic.name, isNameManuallyEdited: topic.isNameManuallyEdited }),
    [patchTopic]
  )

  const handlePinTopic = useCallback(
    async (topic: Pick<RendererTopic, 'id'>) => {
      try {
        await toggleTopicPin(topic.id)
        return true
      } catch (err) {
        logger.error('Failed to toggle topic pin from history records', { topicId: topic.id, err })
        return false
      }
    },
    [toggleTopicPin]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: RendererTopic) => {
      if (topic.pinned) return

      try {
        await deleteTopicById(topic.id)
      } catch (err) {
        logger.error('Failed to delete topic from history records', { topicId: topic.id, err })
        if (isDataApiNotFoundError(err)) toast.info(t('recycle_bin.already_moved'))
        else toast.error(err instanceof Error ? err.message : t('chat.topics.manage.delete.error'))
        return
      }

      if (topic.id === activeRecordId) {
        const nextTopic = findAdjacentHistoryRecordAfterBulkDelete(
          timeSortedTopics,
          [topic.id],
          topic.id,
          (candidate) => candidate.id
        )
        onRecordSelect?.(nextTopic ? getRendererTopic(nextTopic) : null)
      }

      showRecycleBinUndo({
        itemName: topic.name || t('chat.default.topic.name'),
        onUndo: () =>
          restoreRecycleBinItem({
            id: topic.id,
            restore: restoreTopic,
            getActive: (id) => dataApiService.get(`/topics/${id}`),
            refresh: refetch
          })
      })
    },
    [activeRecordId, deleteTopicById, getRendererTopic, onRecordSelect, refetch, restoreTopic, t, timeSortedTopics]
  )

  const handleBulkDeleteTopics = useCallback(
    async (ids: string[]): Promise<HistoryBulkDeleteResult> => {
      const outcomes = await Promise.allSettled(ids.map((id) => deleteTopicById(id, { refresh: false })))
      const staleIds: string[] = []
      const result = outcomes.reduce<HistoryBulkDeleteResult>(
        (summary, outcome, index) => {
          const id = ids[index]
          if (outcome.status === 'fulfilled') summary.succeeded.push(id)
          else {
            if (isDataApiNotFoundError(outcome.reason)) staleIds.push(id)
            summary.failed.push({ id, error: getErrorMessage(outcome.reason) })
          }
          return summary
        },
        { succeeded: [], failed: [] }
      )

      if (result.failed.length > 0) {
        logger.error('Failed to bulk delete topics from history records', { ids, failed: result.failed })
      }
      await refetch().catch((error) => {
        logger.warn('Failed to refresh topics after bulk delete', error as Error, { ids })
      })

      if (result.succeeded.length === 0) {
        if (staleIds.length === ids.length) toast.info(t('recycle_bin.already_moved'))
        else toast.error(t('recycle_bin.move_failed'))
      }

      if (result.succeeded.length > 0) {
        const deletedIds = [...result.succeeded]
        showRecycleBinBatchUndo({
          itemCount: deletedIds.length,
          onUndo: () =>
            restoreRecycleBinItems({
              ids: deletedIds,
              restore: restoreTopic,
              getActive: (id) => dataApiService.get(`/topics/${id}`),
              refresh: refetch
            })
        })
      }

      return result
    },
    [deleteTopicById, refetch, restoreTopic, t]
  )

  const handleBulkMoveTopics = useCallback(
    async (targetAssistantId: string, ids: string[]): Promise<readonly string[] | undefined> => {
      try {
        const results = await batchUpdateTopics(ids.map((id) => ({ id, dto: { assistantId: targetAssistantId } })))
        const movedIds = ids.filter((_, index) => results[index]?.status === 'fulfilled')
        const failedResults = results.filter((result) => result.status === 'rejected')

        if (failedResults.length === 0) {
          toast.success(t('history.records.bulkMoveTopics.success', { count: ids.length }))
          return movedIds
        }

        logger.error('Failed to bulk move topics from history records', { ids, targetAssistantId, failedResults })
        if (movedIds.length > 0) {
          toast.warning(
            t('history.records.bulkMoveTopics.partialSuccess', {
              failed: failedResults.length,
              moved: movedIds.length,
              total: ids.length
            })
          )
          return movedIds
        }

        const firstReason = failedResults[0]?.reason
        const message = firstReason instanceof Error ? firstReason.message : t('history.records.bulkMoveTopics.error')
        toast.error(message)
        return movedIds
      } catch (err) {
        logger.error('Failed to bulk move topics from history records', { ids, targetAssistantId, err })
        const message = err instanceof Error ? err.message : t('history.records.bulkMoveTopics.error')
        toast.error(message)
        return undefined
      }
    },
    [batchUpdateTopics, t]
  )

  const handleClearMessages = useCallback((topic: RendererTopic) => clearTopicMessages(topic.id), [clearTopicMessages])

  const handleAutoRename = useCallback(
    async (topic: RendererTopic) => {
      const messages = await getTopicMessages(topic.id)
      if (messages.length < 2) return

      startTopicRenaming(topic.id)
      let didPersistRename = false
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          try {
            await updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
            didPersistRename = true
          } catch (err) {
            logger.error('Failed to save automatically renamed topic from history records', { topicId: topic.id, err })
            const message = err instanceof Error ? err.message : t('common.save_failed')
            toast.error(message)
          }
        } else if (summaryError) {
          toast.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        if (didPersistRename) {
          finishTopicRenaming(topic.id)
        } else {
          cancelTopicRenaming(topic.id)
        }
      }
    },
    [t, updateTopic]
  )

  const handleRenameTopic = useCallback(
    async (topicId: string, name: string) => {
      const topic = topics.find((candidate) => candidate.id === topicId)
      const trimmedName = name.trim()
      if (!topic || !trimmedName || trimmedName === topic.name) return

      try {
        await renameTopicOptimistically(topic, trimmedName, async () => {
          await updateTopic({ id: topic.id, name: trimmedName, isNameManuallyEdited: true })
          return true
        })
        toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename topic from history records', { topicId, err })
        const message = err instanceof Error ? err.message : t('common.save_failed')
        toast.error(message)
      }
    },
    [renameTopicOptimistically, t, topics, updateTopic]
  )

  const getTopicActionContext = useCallback(
    (apiTopic: ApiTopic): TopicActionContext => {
      const topic = getRendererTopic(apiTopic)

      return createTopicActionContext({
        exportMenuOptions: exportMenuOptions as TopicExportMenuOptions,
        isActiveInCurrentTab: false,
        isRenaming: isTopicRenaming(topic.id),
        onAutoRename: handleAutoRename,
        onClearMessages: handleClearMessages,
        onDelete: handleDeleteTopicFromMenu,
        onPinTopic: async (topic) => {
          await handlePinTopic(topic)
        },
        onStartRename: () => undefined,
        notesPath,
        t,
        topic,
        topicsLength: topics.length
      })
    },
    [
      exportMenuOptions,
      getRendererTopic,
      handleAutoRename,
      handleClearMessages,
      handleDeleteTopicFromMenu,
      handlePinTopic,
      isTopicRenaming,
      notesPath,
      t,
      topics.length
    ]
  )
  const topicMenuPreset = useTopicMenuPreset<ApiTopic>({ getActionContext: getTopicActionContext })

  const getId = useCallback((topic: HistoryTopicItem) => topic.id, [])
  const getSourceId = useCallback((topic: HistoryTopicItem) => getTopicSourceId(topic, assistantById), [assistantById])
  const matchesSearch = useCallback(
    (topic: HistoryTopicItem, keywords: string) =>
      (topic.name || t('chat.default.topic.name')).toLowerCase().includes(keywords),
    [t]
  )
  const onActiveRecordChange = useCallback(
    (topic: HistoryTopicItem | null) => onRecordSelect?.(topic ? getRendererTopic(topic) : null),
    [getRendererTopic, onRecordSelect]
  )
  const rowDescriptor = useMemo(
    () => ({
      getName: (topic: HistoryTopicItem) => topic.name || t('chat.default.topic.name'),
      getUpdatedAt: (topic: HistoryTopicItem) => topic.lastActivityAt,
      getSourceLabel: (topic: HistoryTopicItem) =>
        (topic.assistantId ? assistantById.get(topic.assistantId)?.name : undefined) ?? unlinkedAssistantLabel,
      renderAvatar: (topic: HistoryTopicItem) => {
        const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
        return (
          renderAssistantEntityIcon(
            assistantIconType,
            {
              emoji: assistant?.emoji ?? DEFAULT_ASSISTANT_EMOJI,
              modelId: assistant?.modelId ?? defaultModelId,
              modelName: assistant?.modelName
            },
            defaultModelId
          ) ?? <Bot size={14} />
        )
      },
      rowHeight: 32,
      getSelectLabel: (topic: HistoryTopicItem) =>
        `${t('common.select')} ${topic.name || t('chat.default.topic.name')}`,
      getRowActions: (topic: HistoryTopicItem, openRename: (id: string, name: string) => void) => {
        const contextOverride = { onStartRename: () => openRename(topic.id, topic.name ?? '') }
        const actions = topicMenuPreset.getActions(topic, contextOverride)
        return {
          actions,
          onAction: (action: ResolvedAction) => topicMenuPreset.onAction(topic, action, contextOverride)
        }
      },
      onOpen: handleTopicSelect,
      onTogglePin: handlePinTopic,
      renderRowMenu: (_topic: HistoryTopicItem, row: ReactElement, rowActions: HistoryRowActions) =>
        rowActions.actions.length ? (
          <HistoryActionContextMenu actions={rowActions.actions} className="z-50" onAction={rowActions.onAction}>
            {row}
          </HistoryActionContextMenu>
        ) : (
          row
        )
    }),
    [
      assistantById,
      assistantIconType,
      defaultModelId,
      handlePinTopic,
      handleTopicSelect,
      t,
      topicMenuPreset,
      unlinkedAssistantLabel
    ]
  )

  const descriptor: HistoryRecordDescriptor<HistoryTopicItem> = {
    mode: 'assistant',
    getId,
    isPinned: isTopicPinned,
    getSourceId,
    matchesSearch,
    onBulkDelete: handleBulkDeleteTopics,
    onActiveRecordChange,
    ...rowDescriptor,
    sources: assistantSources,
    renderSourceFilter: (selectedId, onSelect) => {
      const source = selectedId ? assistantSources.find((candidate) => candidate.id === selectedId) : undefined
      const assistant = selectedId ? assistantById.get(selectedId) : undefined
      return (
        <HistorySourceFilterField
          label={
            selectedId
              ? source?.label || assistant?.name || t('common.unnamed')
              : t('history.records.filter.selectAssistant')
          }
          hasValue={!!selectedId}
          clearLabel={t('common.clear')}
          onClear={() => onSelect(null)}
          icon={
            selectedId ? (
              source?.icon ? (
                source.icon
              ) : assistant?.emoji ? (
                <span aria-hidden>{assistant.emoji}</span>
              ) : (
                <Bot size={14} />
              )
            ) : undefined
          }
          selector={(trigger) => (
            <AssistantSelector
              multi={false}
              value={selectedId}
              onChange={onSelect}
              trigger={trigger}
              additionalItems={additionalAssistantSourceItems}
            />
          )}
        />
      )
    },
    bulkMoveTargets,
    onBulkMove: handleBulkMoveTopics,
    onRename: handleRenameTopic,
    strings: {
      sourceLabel: t('common.assistant'),
      searchPlaceholder: t('history.records.searchTopic'),
      titleColumnLabel: t('history.records.table.conversation'),
      emptyTitle: t('history.records.empty.title'),
      emptyDescription: t('history.records.empty.description'),
      loadingTitle: t('history.records.loading.title'),
      loadingDescription: t('history.records.loading.description'),
      pinLabel: t('chat.topics.pin'),
      unpinLabel: t('chat.topics.unpin'),
      deleteLabel: t('common.delete'),
      renameDialogTitle: t('chat.topics.edit.title')
    }
  }

  const controller = useHistoryRecordsController({
    descriptor,
    timeSorted: timeSortedTopics,
    sourceSorted: assistantSortedTopics,
    activeRecordId
  })

  return (
    <HistoryRecordsContent
      descriptor={descriptor}
      controller={controller}
      isLoading={isTopicsLoading}
      toolbarLeading={toolbarLeading}
    />
  )
}

export default AssistantHistoryRecords
