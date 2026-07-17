import { loggerService } from '@logger'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type {
  TopicActionContext,
  TopicExportMenuOptions
} from '@renderer/components/chat/actions/topicContextMenuActions'
import { renderAssistantEntityIcon, useResourceListPinnedItems } from '@renderer/components/chat/resourceList/base'
import { AssistantSelector } from '@renderer/components/resourceCatalog/selectors'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@renderer/data/hooks/usePreference'
import { createTopicActionContext, useTopicMenuPreset } from '@renderer/hooks/chat/useTopicMenuActions'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useDebouncedValue } from '@renderer/hooks/useDebouncedValue'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePinMutations } from '@renderer/hooks/usePins'
import {
  finishTopicRenaming,
  getTopicMessages,
  mapApiTopicToRendererTopic,
  startTopicRenaming,
  useTopicMutations,
  useTopics,
  useTopicStats
} from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import type { Topic as RendererTopic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import type { TopicListItem } from '@shared/data/api/schemas/topics'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { Bot } from 'lucide-react'
import { type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HistoryRecordsContent } from './components/HistoryRecordsContent'
import { HistorySourceFilterField } from './components/HistorySourceFilter'
import { HistoryActionContextMenu } from './components/HistoryTableParts'
import type { HistoryRecordDescriptor, HistoryRowActions } from './historyRecordsDescriptor'
import {
  ALL_SOURCE_ID,
  buildAssistantSources,
  findAdjacentHistoryRecordAfterBulkDelete,
  toServerOwnerScope
} from './historyRecordsHelpers'
import type { HistoryBulkMoveTarget } from './historyRecordsTypes'
import { useHistoryRecordsController, useHistoryRecordsFilters } from './useHistoryRecordsController'
import { usePinnedBandPagination } from './usePinnedBandPagination'

const SEARCH_DEBOUNCE_MS = 300

const logger = loggerService.withContext('AssistantHistoryRecords')

type HistoryTopicItem = TopicListItem & { assistantId: string | undefined }
type OptimisticHistoryTopicPatch = Partial<Pick<HistoryTopicItem, 'assistantId' | 'name'>>

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
  const conversationNav = useConversationNavigation('assistants')

  // The wrapper owns server-side search and source filters; the controller
  // below only owns selection.
  const filters = useHistoryRecordsFilters()
  const debouncedSearch = useDebouncedValue(filters.searchText, SEARCH_DEBOUNCE_MS)
  const ownerScope = toServerOwnerScope(filters.selectedSourceId)
  const bandContinuityKey = JSON.stringify({ ownerScope, q: debouncedSearch })
  const historySortBy = 'createdAt' as const
  const pinnedTopicsSource = useTopics({
    q: debouncedSearch,
    searchScope: 'name-or-owner',
    assistantId: ownerScope,
    pinned: true
  })
  const unpinnedTopicsSource = useTopics({
    sortBy: historySortBy,
    q: debouncedSearch,
    searchScope: 'name-or-owner',
    assistantId: ownerScope,
    pinned: false
  })
  const {
    items: sourceBandTopics,
    error: topicsError,
    isLoading: isTopicsLoading,
    isLoadingMore: isBandLoadingMore,
    loadNext: loadNextTopics,
    reload: reloadTopics
  } = usePinnedBandPagination(
    {
      items: pinnedTopicsSource.topics,
      error: pinnedTopicsSource.error,
      hasNext: pinnedTopicsSource.hasNext,
      isLoading: pinnedTopicsSource.isLoading,
      isLoadingMore: pinnedTopicsSource.isRefreshing,
      loadNext: pinnedTopicsSource.loadNext,
      reload: pinnedTopicsSource.refetch
    },
    {
      items: unpinnedTopicsSource.topics,
      error: unpinnedTopicsSource.error,
      hasNext: unpinnedTopicsSource.hasNext,
      isLoading: unpinnedTopicsSource.isLoading,
      isLoadingMore: unpinnedTopicsSource.isRefreshing,
      loadNext: unpinnedTopicsSource.loadNext,
      reload: unpinnedTopicsSource.refetch
    },
    { continuityKey: bandContinuityKey }
  )
  const { stats: topicStats } = useTopicStats()
  const { assistants } = useAssistants()
  const [assistantIconType] = usePreference('assistant.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
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
  const { pin: pinTopic, unpin: unpinTopic, isMutating: isPinsMutating } = usePinMutations('topic')
  const commitTopicPin = useCallback(
    async (topic: TopicListItem) => {
      if (topic.pinId) await unpinTopic(topic.pinId)
      else await pinTopic(topic.id)
    },
    [pinTopic, unpinTopic]
  )
  const { items: projectedBandTopics, togglePinned: togglePinnedTopicItem } = useResourceListPinnedItems({
    disabled: isPinsMutating,
    items: sourceBandTopics,
    onTogglePin: commitTopicPin,
    resetKey: bandContinuityKey
  })
  const [optimisticallyRemovedTopicIds, setOptimisticallyRemovedTopicIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [optimisticTopicPatches, setOptimisticTopicPatches] = useState<Record<string, OptimisticHistoryTopicPatch>>({})
  const projectedBandTopicById = useMemo(
    () => new Map(projectedBandTopics.map((topic) => [topic.id, topic])),
    [projectedBandTopics]
  )

  useEffect(() => {
    setOptimisticallyRemovedTopicIds(new Set())
    setOptimisticTopicPatches({})
  }, [bandContinuityKey])

  useEffect(() => {
    setOptimisticallyRemovedTopicIds((current) => {
      const next = new Set([...current].filter((id) => projectedBandTopicById.has(id)))
      return next.size === current.size ? current : next
    })
    setOptimisticTopicPatches((current) => {
      let changed = false
      const next = { ...current }
      for (const [id, patch] of Object.entries(current)) {
        const source = projectedBandTopicById.get(id)
        if (!source) continue
        if (Object.entries(patch).every(([key, value]) => source[key as keyof HistoryTopicItem] === value)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [projectedBandTopicById])
  const renamingTopicIdSet = useMemo(
    () => new Set(Array.isArray(renamingTopics) ? renamingTopics : []),
    [renamingTopics]
  )
  const isTopicRenaming = useCallback((topicId: string) => renamingTopicIdSet.has(topicId), [renamingTopicIdSet])

  const topics = useMemo<HistoryTopicItem[]>(() => {
    const projected = projectedBandTopics
      .filter((topic) => !optimisticallyRemovedTopicIds.has(topic.id))
      .map((topic) => ({
        ...topic,
        ...optimisticTopicPatches[topic.id],
        assistantId: optimisticTopicPatches[topic.id]?.assistantId ?? topic.assistantId
      }))
      .filter((topic) => {
        if (!ownerScope) return true
        if (ownerScope === 'unlinked') return topic.assistantId == null
        return topic.assistantId === ownerScope
      })
    return [...projected.filter((topic) => topic.pinned), ...projected.filter((topic) => !topic.pinned)]
  }, [optimisticTopicPatches, optimisticallyRemovedTopicIds, ownerScope, projectedBandTopics])
  const isTopicsLoadingMore = topics.length > 0 && isBandLoadingMore
  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics])
  const isTopicPinned = useCallback((topicId: string) => topicById.get(topicId)?.pinned === true, [topicById])
  const assistantById = useMemo(() => new Map(assistants.map((assistant) => [assistant.id, assistant])), [assistants])
  const assistantRankById = useMemo(
    () => new Map(assistants.map((assistant, index) => [assistant.id, index])),
    [assistants]
  )
  const unlinkedAssistantLabel = t('history.records.filter.unlinkedAssistant')

  const rendererTopicById = useMemo(
    () => new Map(topics.map((topic) => [topic.id, { ...mapApiTopicToRendererTopic(topic), pinned: topic.pinned }])),
    [topics]
  )
  const getRendererTopic = useCallback(
    (topic: ApiTopic): RendererTopic =>
      rendererTopicById.get(topic.id) ?? { ...mapApiTopicToRendererTopic(topic), pinned: isTopicPinned(topic.id) },
    [isTopicPinned, rendererTopicById]
  )
  const activeRecordIdRef = useRef(activeRecordId)
  useEffect(() => {
    activeRecordIdRef.current = activeRecordId
  }, [activeRecordId])
  const selectActiveTopic = useCallback(
    (topic: RendererTopic | null) => {
      activeRecordIdRef.current = topic?.id ?? null
      onRecordSelect?.(topic)
    },
    [onRecordSelect]
  )

  // The unlinked pseudo-source exists when any topic has no live assistant —
  // a stats fact (byAssistant's null entry), not a scan of loaded pages.
  const hasUnlinkedAssistant = useMemo(
    () =>
      topicStats?.byAssistant.some((entry) => entry.assistantId === null || !assistantById.has(entry.assistantId)) ??
      false,
    [assistantById, topicStats]
  )
  const assistantSources = useMemo(
    () => buildAssistantSources(hasUnlinkedAssistant, assistantById, assistantRankById, unlinkedAssistantLabel, t),
    [assistantById, assistantRankById, hasUnlinkedAssistant, t, unlinkedAssistantLabel]
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

      selectActiveTopic(rendererTopicById.get(topic.id) ?? mapApiTopicToRendererTopic(topic))
      onClose()
    },
    [conversationNav, onClose, rendererTopicById, selectActiveTopic, t]
  )

  const updateTopic = useCallback(
    (topic: RendererTopic) =>
      patchTopic(topic.id, { name: topic.name, isNameManuallyEdited: topic.isNameManuallyEdited }),
    [patchTopic]
  )
  const hideTopicsOptimistically = useCallback((ids: readonly string[]) => {
    setOptimisticallyRemovedTopicIds((current) => {
      const next = new Set(current)
      for (const id of ids) next.add(id)
      return next
    })
  }, [])
  const restoreOptimisticallyHiddenTopics = useCallback((ids: readonly string[]) => {
    setOptimisticallyRemovedTopicIds((current) => {
      const next = new Set(current)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])
  const patchTopicsOptimistically = useCallback((ids: readonly string[], patch: OptimisticHistoryTopicPatch) => {
    setOptimisticTopicPatches((current) => {
      const next = { ...current }
      for (const id of ids) next[id] = { ...next[id], ...patch }
      return next
    })
  }, [])
  const clearOptimisticTopicPatch = useCallback(
    (ids: readonly string[], keys: readonly (keyof OptimisticHistoryTopicPatch)[]) => {
      setOptimisticTopicPatches((current) => {
        const next = { ...current }
        for (const id of ids) {
          const currentPatch = next[id]
          if (!currentPatch) continue
          const remainingPatch = { ...currentPatch }
          for (const key of keys) delete remainingPatch[key]
          if (Object.keys(remainingPatch).length > 0) next[id] = remainingPatch
          else delete next[id]
        }
        return next
      })
    },
    []
  )

  const handlePinTopic = useCallback(
    async (topic: Pick<RendererTopic, 'id'>) => {
      try {
        const projectedTopic = topicById.get(topic.id)
        if (!projectedTopic) return false
        await togglePinnedTopicItem(projectedTopic)
        return true
      } catch (err) {
        logger.error('Failed to toggle topic pin from history records', { topicId: topic.id, err })
        return false
      }
    },
    [togglePinnedTopicItem, topicById]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: RendererTopic) => {
      if (topic.pinned) return

      const wasActive = activeRecordIdRef.current === topic.id
      const nextTopic = wasActive
        ? findAdjacentHistoryRecordAfterBulkDelete(topics, [topic.id], topic.id, (candidate) => candidate.id)
        : undefined
      const optimisticActiveId = nextTopic?.id ?? null
      hideTopicsOptimistically([topic.id])
      if (wasActive) selectActiveTopic(nextTopic ? getRendererTopic(nextTopic) : null)

      try {
        await deleteTopicById(topic.id)
      } catch (err) {
        restoreOptimisticallyHiddenTopics([topic.id])
        if (wasActive && activeRecordIdRef.current === optimisticActiveId) selectActiveTopic(topic)
        logger.error('Failed to delete topic from history records', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        toast.error(message)
      }
    },
    [
      deleteTopicById,
      getRendererTopic,
      hideTopicsOptimistically,
      restoreOptimisticallyHiddenTopics,
      selectActiveTopic,
      t,
      topics
    ]
  )

  const handleBulkDeleteTopics = useCallback(
    async (ids: string[]): Promise<readonly string[] | undefined> => {
      const activeTopic = activeRecordIdRef.current ? topicById.get(activeRecordIdRef.current) : undefined
      const wasActive = !!activeTopic && ids.includes(activeTopic.id)
      const optimisticNextTopic = wasActive
        ? findAdjacentHistoryRecordAfterBulkDelete(topics, ids, activeTopic.id, (candidate) => candidate.id)
        : undefined
      const optimisticActiveId = optimisticNextTopic?.id ?? null
      hideTopicsOptimistically(ids)
      if (wasActive) selectActiveTopic(optimisticNextTopic ? getRendererTopic(optimisticNextTopic) : null)

      try {
        const result = await deleteTopics(ids)
        const deletedIdSet = new Set(result.deletedIds)
        const failedIds = ids.filter((id) => !deletedIdSet.has(id))
        restoreOptimisticallyHiddenTopics(failedIds)
        if (
          wasActive &&
          activeTopic &&
          !deletedIdSet.has(activeTopic.id) &&
          activeRecordIdRef.current === optimisticActiveId
        ) {
          selectActiveTopic(getRendererTopic(activeTopic))
        }
        return result.deletedIds
      } catch (err) {
        restoreOptimisticallyHiddenTopics(ids)
        if (wasActive && activeTopic && activeRecordIdRef.current === optimisticActiveId) {
          selectActiveTopic(getRendererTopic(activeTopic))
        }
        logger.error('Failed to bulk delete topics from history records', { ids, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        toast.error(message)
        return undefined
      }
    },
    [
      deleteTopics,
      getRendererTopic,
      hideTopicsOptimistically,
      restoreOptimisticallyHiddenTopics,
      selectActiveTopic,
      t,
      topicById,
      topics
    ]
  )

  const handleBulkMoveTopics = useCallback(
    async (targetAssistantId: string, ids: string[]): Promise<readonly string[] | undefined> => {
      patchTopicsOptimistically(ids, { assistantId: targetAssistantId })
      try {
        const results = await batchUpdateTopics(ids.map((id) => ({ id, dto: { assistantId: targetAssistantId } })))
        const movedIds = ids.filter((_, index) => results[index]?.status === 'fulfilled')
        const failedIds = ids.filter((_, index) => results[index]?.status === 'rejected')
        const failedResults = results.filter((result) => result.status === 'rejected')
        clearOptimisticTopicPatch(failedIds, ['assistantId'])

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
        clearOptimisticTopicPatch(ids, ['assistantId'])
        logger.error('Failed to bulk move topics from history records', { ids, targetAssistantId, err })
        const message = err instanceof Error ? err.message : t('history.records.bulkMoveTopics.error')
        toast.error(message)
        return undefined
      }
    },
    [batchUpdateTopics, clearOptimisticTopicPatch, patchTopicsOptimistically, t]
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

      patchTopicsOptimistically([topicId], { name: trimmedName })
      try {
        await updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
        toast.success(t('common.saved'))
      } catch (err) {
        clearOptimisticTopicPatch([topicId], ['name'])
        logger.error('Failed to rename topic from history records', { topicId, err })
        const message = err instanceof Error ? err.message : t('common.save_failed')
        toast.error(message)
      }
    },
    [clearOptimisticTopicPatch, patchTopicsOptimistically, rendererTopicById, t, updateTopic]
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
  const onActiveRecordChange = useCallback(
    (topic: HistoryTopicItem | null) => selectActiveTopic(topic ? getRendererTopic(topic) : null),
    [getRendererTopic, selectActiveTopic]
  )
  const rowDescriptor = useMemo(
    () => ({
      getName: (topic: HistoryTopicItem) => topic.name || t('chat.default.topic.name'),
      getCreatedAt: (topic: HistoryTopicItem) => topic.createdAt,
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
    items: topics,
    filters,
    activeRecordId
  })

  const handleEndReached = useCallback(() => {
    if (isTopicsLoading || isTopicsLoadingMore || topicsError) return
    loadNextTopics()
  }, [isTopicsLoading, isTopicsLoadingMore, loadNextTopics, topicsError])
  const handleRetry = useCallback(() => {
    void reloadTopics()
  }, [reloadTopics])

  return (
    <HistoryRecordsContent
      descriptor={descriptor}
      controller={controller}
      error={topicsError}
      isLoading={isTopicsLoading}
      isLoadingMore={isTopicsLoadingMore}
      toolbarLeading={toolbarLeading}
      onEndReached={handleEndReached}
      onRetry={handleRetry}
    />
  )
}

export default AssistantHistoryRecords
