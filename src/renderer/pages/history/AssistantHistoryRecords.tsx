import { loggerService } from '@logger'
import type {
  TopicActionContext,
  TopicExportMenuOptions
} from '@renderer/components/chat/actions/topicContextMenuActions'
import { createTopicActionContext, useTopicMenuPreset } from '@renderer/components/chat/actions/useTopicMenuActions'
import { sortTopicsForDisplayGroups } from '@renderer/components/chat/resourceList/topicsHelpers'
import { AssistantSelector } from '@renderer/components/resourceCatalog/selectors'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMultiplePreferences } from '@renderer/data/hooks/usePreference'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePins } from '@renderer/hooks/usePins'
import {
  finishTopicRenaming,
  getTopicMessages,
  mapApiTopicToRendererTopic,
  startTopicRenaming,
  useTopicMutations,
  useTopics
} from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import type { Topic as RendererTopic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { Bot } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HistoryRecordsContent } from './components/HistoryRecordsContent'
import { HistorySourceFilterField } from './components/HistorySourceFilter'
import { HistoryActionContextMenu } from './components/HistoryTableParts'
import type { HistoryRecordDescriptor } from './historyRecordsDescriptor'
import {
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
  const [groupNow] = useState(() => new Date())
  const conversationNav = useConversationNavigation('assistants')

  const { topics: rawTopics, isLoading: isTopicsLoading } = useTopics({ loadAll: true })
  const { assistants } = useAssistants()
  const [renamingTopics] = useCache('topic.renaming')
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById, deleteTopics, batchUpdateTopics } = useTopicMutations()
  const [exportMenuOptions] = useMultiplePreferences({
    docx: 'data.export.menus.docx',
    image: 'data.export.menus.image',
    joplin: 'data.export.menus.joplin',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notes: 'data.export.menus.notes',
    notion: 'data.export.menus.notion',
    obsidian: 'data.export.menus.obsidian',
    plain_text: 'data.export.menus.plain_text',
    siyuan: 'data.export.menus.siyuan',
    yuque: 'data.export.menus.yuque'
  })
  const { pinnedIds: topicPinnedIds, togglePin: toggleTopicPin } = usePins('topic')

  const topicPinnedIdSet = useMemo(() => new Set(topicPinnedIds), [topicPinnedIds])
  const isTopicPinned = useCallback((topicId: string) => topicPinnedIdSet.has(topicId), [topicPinnedIdSet])
  const renamingTopicIdSet = useMemo(
    () => new Set(Array.isArray(renamingTopics) ? renamingTopics : []),
    [renamingTopics]
  )
  const isTopicRenaming = useCallback((topicId: string) => renamingTopicIdSet.has(topicId), [renamingTopicIdSet])

  const topics = useMemo<HistoryTopicItem[]>(
    () => rawTopics.map((topic) => ({ ...topic, assistantId: topic.assistantId, pinned: isTopicPinned(topic.id) })),
    [isTopicPinned, rawTopics]
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

  const rendererTopicById = useMemo(
    () =>
      new Map(
        topics.map((topic) => [topic.id, { ...mapApiTopicToRendererTopic(topic), pinned: isTopicPinned(topic.id) }])
      ),
    [isTopicPinned, topics]
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

      onRecordSelect?.(rendererTopicById.get(topic.id) ?? mapApiTopicToRendererTopic(topic))
      onClose()
    },
    [conversationNav, onClose, onRecordSelect, rendererTopicById, t]
  )

  const updateTopic = useCallback(
    (topic: RendererTopic) =>
      patchTopic(topic.id, { name: topic.name, isNameManuallyEdited: topic.isNameManuallyEdited }),
    [patchTopic]
  )

  const handlePinTopic = useCallback(
    async (topic: Pick<RendererTopic, 'id'>) => {
      try {
        await toggleTopicPin(topic.id)
      } catch (err) {
        logger.error('Failed to toggle topic pin from history records', { topicId: topic.id, err })
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
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        toast.error(message)
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
    },
    [activeRecordId, deleteTopicById, getRendererTopic, onRecordSelect, t, timeSortedTopics]
  )

  const handleBulkDeleteTopics = useCallback(
    async (ids: string[]): Promise<readonly string[] | undefined> => {
      try {
        const result = await deleteTopics(ids)
        return result.deletedIds
      } catch (err) {
        logger.error('Failed to bulk delete topics from history records', { ids, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        toast.error(message)
        return undefined
      }
    },
    [deleteTopics, t]
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

  const handleClearMessages = useCallback((topic: RendererTopic) => {
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleAutoRename = useCallback(
    async (topic: RendererTopic) => {
      const messages = await getTopicMessages(topic.id)
      if (messages.length < 2) return

      startTopicRenaming(topic.id)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          void updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
        } else if (summaryError) {
          toast.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topic.id)
      }
    },
    [t, updateTopic]
  )

  const handleRenameTopic = useCallback(
    async (topicId: string, name: string) => {
      const topic = rendererTopicById.get(topicId)
      const trimmedName = name.trim()
      if (!topic || !trimmedName || trimmedName === topic.name) return

      try {
        await updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
        toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename topic from history records', { topicId, err })
        const message = err instanceof Error ? err.message : t('common.save_failed')
        toast.error(message)
      }
    },
    [rendererTopicById, t, updateTopic]
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
        onPinTopic: handlePinTopic,
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

  const descriptor: HistoryRecordDescriptor<HistoryTopicItem> = {
    mode: 'assistant',
    getId,
    isPinned: isTopicPinned,
    getSourceId,
    matchesSearch,
    onBulkDelete: handleBulkDeleteTopics,
    onActiveRecordChange,
    getName: (topic) => topic.name || t('chat.default.topic.name'),
    getUpdatedAt: (topic) => topic.updatedAt,
    getSourceLabel: (topic) =>
      (topic.assistantId ? assistantById.get(topic.assistantId)?.name : undefined) ?? unlinkedAssistantLabel,
    renderAvatar: (topic) => {
      const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
      return assistant?.emoji ? <span aria-hidden>{assistant.emoji}</span> : <Bot size={14} />
    },
    rowHeight: 32,
    getSelectLabel: (topic) => `${t('common.select')} ${topic.name || t('chat.default.topic.name')}`,
    getRowActions: (topic, openRename) => {
      const contextOverride = { onStartRename: () => openRename(topic.id, topic.name ?? '') }
      const actions = topicMenuPreset.getActions(topic, contextOverride)
      return { actions, onAction: (action) => topicMenuPreset.onAction(topic, action, contextOverride) }
    },
    onOpen: handleTopicSelect,
    onTogglePin: handlePinTopic,
    renderRowMenu: (_topic, row, rowActions) =>
      rowActions.actions.length ? (
        <HistoryActionContextMenu actions={rowActions.actions} className="z-50" onAction={rowActions.onAction}>
          {row}
        </HistoryActionContextMenu>
      ) : (
        row
      ),
    sources: assistantSources,
    renderSourceFilter: (selectedId, onSelect) => {
      const assistant = selectedId ? assistantById.get(selectedId) : undefined
      return (
        <HistorySourceFilterField
          label={selectedId ? assistant?.name || t('common.unnamed') : t('history.records.filter.selectAssistant')}
          hasValue={!!selectedId}
          clearLabel={t('common.clear')}
          onClear={() => onSelect(null)}
          icon={
            selectedId ? assistant?.emoji ? <span aria-hidden>{assistant.emoji}</span> : <Bot size={14} /> : undefined
          }
          selector={(trigger) => (
            <AssistantSelector multi={false} value={selectedId} onChange={onSelect} trigger={trigger} />
          )}
        />
      )
    },
    bulkMoveTargets,
    onBulkMove: handleBulkMoveTopics,
    onRename: handleRenameTopic,
    strings: {
      subtitle: t('history.records.assistantSubtitle', { count: topics.length }),
      sourceLabel: t('common.assistant'),
      sourcePlaceholder: t('history.records.filter.sourcePlaceholder'),
      sourceSearchPlaceholder: t('history.records.filter.sourceSearchPlaceholder'),
      sourceEmpty: t('history.records.filter.sourceEmpty'),
      searchPlaceholder: t('history.records.searchTopic'),
      titleColumnLabel: t('history.records.table.title'),
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
