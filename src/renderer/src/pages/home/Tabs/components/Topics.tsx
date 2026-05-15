import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  ResourceList,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  TopicResourceList,
  useResourceList,
  useResourceListPinnedState
} from '@renderer/components/chat/resources'
import EditNameDialog from '@renderer/components/EditNameDialog'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { isMac } from '@renderer/config/constant'
import { prefetch } from '@renderer/data/hooks/useDataApi'
import { useAssistantsApi } from '@renderer/hooks/useAssistantDataApi'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePins } from '@renderer/hooks/usePins'
import { finishTopicRenaming, getTopicMessages, startTopicRenaming } from '@renderer/hooks/useTopic'
import { mapApiTopicToRendererTopic, useAllTopics, useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils/naming'
import { cn } from '@renderer/utils/style'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import {
  Check,
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  Clock3,
  ListChecks,
  ListFilter,
  PinIcon,
  Plus,
  Sparkles,
  Square,
  Trash2,
  XIcon
} from 'lucide-react'
import type { MouseEvent, RefObject } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import type { TopicExportMenuOptions } from './topicContextMenuActions'
import { TopicManagePanel, useTopicManageMode } from './TopicManageMode'
import {
  applyOptimisticTopicDisplayMove,
  buildAssistantGroupDropAnchor,
  buildTopicDropAnchor,
  createTopicDisplayGroupResolver,
  filterTopicsForManageMode,
  getAssistantIdFromTopicGroupId,
  moveAssistantGroupAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups,
  TOPIC_DEFAULT_ASSISTANT_GROUP_ID,
  TOPIC_PINNED_GROUP_ID,
  TOPIC_TODAY_GROUP_ID,
  TOPIC_UNKNOWN_ASSISTANT_GROUP_ID,
  type TopicDisplayMode
} from './Topics.helpers'
import { useTopicMenuActions } from './useTopicMenuActions'

const logger = loggerService.withContext('Topics')

interface Props {
  activeTopic: Topic
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  revealRequest?: ResourceListRevealRequest
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

const TOPIC_DISPLAY_OPTIONS: TopicDisplayMode[] = ['time', 'assistant']
const DEFAULT_ASSISTANT_GROUP_EMOJI = '😀'

function resolveAssistantIdForTopicGroup(
  groupId: string,
  assistantById: ReadonlyMap<string, unknown>
): string | null | undefined {
  if (groupId === TOPIC_DEFAULT_ASSISTANT_GROUP_ID) {
    return null
  }

  const assistantId = getAssistantIdFromTopicGroupId(groupId)
  if (!assistantId || !assistantById.has(assistantId)) {
    return undefined
  }

  return assistantId
}

function TopicDisplayModeMenu({
  mode,
  onChange
}: {
  mode: TopicDisplayMode
  onChange: (mode: TopicDisplayMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('chat.topics.display.title')}
          className="inline-flex size-5 shrink-0 items-center justify-center p-0 leading-none text-muted-foreground/55 shadow-none hover:bg-transparent hover:text-muted-foreground/75 [&_svg]:block [&_svg]:shrink-0">
          <ListFilter size={12} className="block" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-28 rounded-lg border-border p-1 shadow-lg">
        <MenuList className="gap-0.5">
          <div className="px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground/60">
            {t('chat.topics.display.title')}
          </div>
          {TOPIC_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              label={t(`chat.topics.display.${option}`)}
              active={mode === option}
              suffix={mode === option ? <Check size={11} /> : null}
              className="h-6 gap-1.5 rounded-md px-1.5 py-0 text-[11px] font-normal text-muted-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground [&_svg]:size-3"
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

export function Topics({ activeTopic, onOpenHistory, revealRequest, setActiveTopic, position }: Props) {
  const { t } = useTranslation()
  const [groupNow] = useState(() => dayjs())
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById, refreshTopics } = useTopicMutations()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [collapsedTopicGroupIds, setCollapsedTopicGroupIds] = usePreference('topic.tab.collapsed_group_ids')
  const [topicPosition] = usePreference('topic.position')
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
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

  const {
    isMutating: isPinsMutating,
    isRefreshing: isPinsRefreshing,
    pinnedIds: topicPinnedIds,
    togglePin: toggleTopicPin
  } = usePins('topic')
  const topicPinState = useResourceListPinnedState({
    disabled: isPinsRefreshing || isPinsMutating,
    pinnedIds: topicPinnedIds,
    onTogglePin: toggleTopicPin
  })
  const { isPinned: isTopicPinned, togglePinned: toggleTopicPinned } = topicPinState
  const { topics: apiTopics, isLoading, error } = useAllTopics({ loadAll: true })
  const displayMode = topicDisplayMode ?? 'time'
  const isAssistantDisplayMode = displayMode === 'assistant'
  const {
    assistants,
    isLoading: isAssistantsLoading,
    error: assistantsError,
    refetch: refreshAssistants
  } = useAssistantsApi({ enabled: isAssistantDisplayMode })
  const listRef = useRef<HTMLDivElement>(null)
  const deleteTimerRef = useRef<NodeJS.Timeout>(null)
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)

  const apiBackedTopics = useMemo(
    () =>
      apiTopics.map((apiTopic) => {
        const topic = mapApiTopicToRendererTopic(apiTopic)
        return { ...topic, pinned: isTopicPinned(apiTopic.id) }
      }),
    [apiTopics, isTopicPinned]
  )
  const [optimisticMove, setOptimisticMove] = useState<{
    payload: ResourceListItemReorderPayload
    targetAssistantId: string | null
  } | null>(null)
  const apiTopicOrderSignature = useMemo(
    () =>
      apiBackedTopics
        .map((topic) => `${topic.id}:${topic.assistantId ?? ''}:${topic.orderKey ?? ''}:${topic.pinned ? '1' : '0'}`)
        .join('|'),
    [apiBackedTopics]
  )
  const topics = apiBackedTopics

  useEffect(() => {
    setOptimisticMove(null)
  }, [apiTopicOrderSignature])

  const [optimisticAssistantOrderIds, setOptimisticAssistantOrderIds] = useState<readonly string[] | null>(null)
  const assistantOrderSignature = useMemo(
    () => assistants.map((assistant) => `${assistant.id}:${assistant.orderKey ?? ''}`).join('|'),
    [assistants]
  )

  useEffect(() => {
    setOptimisticAssistantOrderIds(null)
  }, [assistantOrderSignature])

  const orderedAssistants = useMemo(() => {
    if (!optimisticAssistantOrderIds) {
      return assistants
    }

    const assistantById = new Map(assistants.map((assistant) => [assistant.id, assistant]))
    const ordered = optimisticAssistantOrderIds.flatMap((assistantId) => {
      const assistant = assistantById.get(assistantId)
      return assistant ? [assistant] : []
    })
    const optimisticIds = new Set(optimisticAssistantOrderIds)

    for (const assistant of assistants) {
      if (!optimisticIds.has(assistant.id)) {
        ordered.push(assistant)
      }
    }

    return ordered
  }, [assistants, optimisticAssistantOrderIds])
  const assistantById = useMemo(
    () => new Map(orderedAssistants.map((assistant) => [assistant.id, assistant])),
    [orderedAssistants]
  )
  const assistantRankById = useMemo(
    () => new Map(orderedAssistants.map((assistant, index) => [assistant.id, index])),
    [orderedAssistants]
  )

  const manageState = useTopicManageMode()
  const { isManageMode, selectedIds, searchText, enterManageMode, exitManageMode, toggleSelectTopic } = manageState
  const handledRevealModeExitRef = useRef<string | null>(null)
  const deferredSearchText = useDeferredValue(searchText)
  const { isFulfilled: isActiveTopicStreamFulfilled, markSeen: markActiveTopicStreamSeen } = useTopicStreamStatus(
    activeTopic.id
  )

  useEffect(() => {
    if (isActiveTopicStreamFulfilled) {
      markActiveTopicStreamSeen()
    }
  }, [isActiveTopicStreamFulfilled, markActiveTopicStreamSeen])

  useEffect(() => {
    if (!revealRequest) return

    const requestKey = `${revealRequest.requestId}:${revealRequest.itemId}`
    if (handledRevealModeExitRef.current === requestKey) return

    handledRevealModeExitRef.current = requestKey
    if (isManageMode) {
      exitManageMode()
    }
  }, [exitManageMode, isManageMode, revealRequest])

  const updateTopic = useCallback(
    (topic: Topic) =>
      patchTopic(topic.id, {
        name: topic.name,
        isNameManuallyEdited: topic.isNameManuallyEdited
      }),
    [patchTopic]
  )

  const removeTopic = useCallback((topic: Topic) => deleteTopicById(topic.id), [deleteTopicById])

  const handleRenameTopic = useCallback(
    (topicId: string, name: string) => {
      const topic = topics.find((candidate) => candidate.id === topicId)
      const trimmedName = name.trim()
      if (!topic || !trimmedName || trimmedName === topic.name) {
        return
      }

      void updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
      window.toast.success(t('common.saved'))
    },
    [topics, t, updateTopic]
  )

  const isRenaming = useCallback((topicId: string) => renamingTopics.includes(topicId), [renamingTopics])
  const isNewlyRenamed = useCallback((topicId: string) => newlyRenamedTopics.includes(topicId), [newlyRenamedTopics])

  const handleDeleteClick = useCallback((topicId: string, event: MouseEvent) => {
    event.stopPropagation()

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
    }

    setDeletingTopicId(topicId)
    deleteTimerRef.current = setTimeout(() => setDeletingTopicId(null), 2000)
  }, [])

  const handleConfirmDelete = useCallback(
    async (topic: Topic, event?: MouseEvent) => {
      event?.stopPropagation()

      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        setDeletingTopicId(null)
        return
      }

      if (topic.id === activeTopic.id && topics.length > 1) {
        const index = findIndex(topics, (candidate) => candidate.id === topic.id)
        setActiveTopic(topics[index + 1 === topics.length ? index - 1 : index + 1])
      }
      setDeletingTopicId(null)
    },
    [activeTopic.id, removeTopic, setActiveTopic, t, topics]
  )

  const handlePinTopic = useCallback(
    async (topic: Topic) => {
      const nextPinned = !topic.pinned
      if (nextPinned) {
        setTimeout(() => listRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' }), 50)
      }

      try {
        await toggleTopicPinned(topic.id)
      } catch (err) {
        logger.error('Failed to toggle topic pin', { topicId: topic.id, err })
      }
    },
    [toggleTopicPinned]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: Topic) => {
      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        return
      }

      if (topic.id === activeTopic.id && topics.length > 1) {
        const index = findIndex(topics, (candidate) => candidate.id === topic.id)
        setActiveTopic(topics[index + 1 === topics.length ? index - 1 : index + 1])
      }
    },
    [activeTopic.id, removeTopic, setActiveTopic, t, topics]
  )

  const handleClearMessages = useCallback((topic: Topic) => {
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleAutoRename = useCallback(
    async (topic: Topic) => {
      const messages = await getTopicMessages(topic.id)
      if (messages.length < 2) return

      startTopicRenaming(topic.id)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          void updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
        } else if (summaryError) {
          window.toast?.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topic.id)
      }
    },
    [t, updateTopic, finishTopicRenaming]
  )

  const topicGroupBy = useMemo(
    () =>
      createTopicDisplayGroupResolver<Topic>({
        assistantById,
        mode: displayMode,
        labels: {
          pinned: t('selector.common.pinned_title'),
          time: {
            today: t('chat.topics.group.today'),
            yesterday: t('chat.topics.group.yesterday'),
            'this-week': t('chat.topics.group.this_week'),
            earlier: t('chat.topics.group.earlier')
          },
          assistant: {
            default: t('chat.default.name'),
            unknown: t('chat.topics.group.unknown_assistant')
          }
        },
        now: groupNow
      }),
    [assistantById, displayMode, groupNow, t]
  )

  const baseGroupedTopics = useMemo(
    () =>
      sortTopicsForDisplayGroups(topics, {
        assistantRankById,
        mode: displayMode,
        now: groupNow
      }),
    [assistantRankById, displayMode, groupNow, topics]
  )

  const groupedTopics = useMemo(
    () =>
      optimisticMove
        ? applyOptimisticTopicDisplayMove(
            baseGroupedTopics,
            optimisticMove.payload,
            optimisticMove.targetAssistantId,
            topicGroupBy
          )
        : baseGroupedTopics,
    [baseGroupedTopics, optimisticMove, topicGroupBy]
  )

  const filteredTopics = useMemo(
    () => filterTopicsForManageMode(groupedTopics, deferredSearchText, isManageMode),
    [deferredSearchText, groupedTopics, isManageMode]
  )

  const listError = error || (isAssistantDisplayMode ? assistantsError : undefined)
  const listLoading = isLoading || (isAssistantDisplayMode && isAssistantsLoading)
  const listStatus = listError ? 'error' : listLoading ? 'loading' : filteredTopics.length === 0 ? 'empty' : 'idle'
  const singlealone = topicPosition === 'right' && position === 'right'

  const getGroupHeaderAction = useCallback(
    (group: { id: string }) => {
      let payload: { assistantId: string | null } | undefined

      if (displayMode === 'time') {
        if (group.id !== TOPIC_TODAY_GROUP_ID) return null
      } else if (group.id === TOPIC_DEFAULT_ASSISTANT_GROUP_ID) {
        payload = { assistantId: null }
      } else {
        const assistantId = getAssistantIdFromTopicGroupId(group.id)
        if (!assistantId || !assistantById.has(assistantId)) return null

        payload = { assistantId }
      }

      return (
        <Tooltip title={t('chat.add.topic.title')} delay={500}>
          <ResourceList.HeaderActionButton
            type="button"
            aria-label={t('chat.add.topic.title')}
            onClick={() =>
              payload === undefined
                ? void EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC)
                : void EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC, payload)
            }>
            <Plus size={12} className="block" />
          </ResourceList.HeaderActionButton>
        </Tooltip>
      )
    },
    [assistantById, displayMode, t]
  )

  const getGroupHeaderIcon = useCallback(
    (group: { id: string }, { collapsed }: { collapsed: boolean }) => {
      if (group.id === TOPIC_PINNED_GROUP_ID) {
        return <ChevronDown size={14} className={cn('transition-transform', collapsed && '-rotate-90')} />
      }

      if (displayMode !== 'assistant') {
        return <ChevronDown size={14} className={cn('transition-transform', collapsed && '-rotate-90')} />
      }

      if (group.id === TOPIC_DEFAULT_ASSISTANT_GROUP_ID) {
        return <EmojiIcon emoji={DEFAULT_ASSISTANT_GROUP_EMOJI} size={14} fontSize={10} className="mr-0" />
      }

      if (group.id === TOPIC_UNKNOWN_ASSISTANT_GROUP_ID) {
        return <Sparkles size={13} />
      }

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      const assistant = assistantId ? assistantById.get(assistantId) : undefined
      if (!assistant) {
        return <Sparkles size={13} />
      }

      return (
        <EmojiIcon
          emoji={assistant.emoji || getLeadingEmoji(assistant.name)}
          size={14}
          fontSize={10}
          className="mr-0"
        />
      )
    },
    [assistantById, displayMode]
  )

  const handleCollapsedTopicGroupIdsChange = useCallback(
    (nextGroupIds: string[]) => void setCollapsedTopicGroupIds(nextGroupIds),
    [setCollapsedTopicGroupIds]
  )
  const handleOpenHistoryOrToggleSidebar = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (onOpenHistory) {
        onOpenHistory(event.currentTarget.getBoundingClientRect())
        return
      }

      void setShowSidebar(!showSidebar)
    },
    [onOpenHistory, setShowSidebar, showSidebar]
  )

  const canDragTopicItem = useCallback(
    ({ item }: { item: Topic }) => isAssistantDisplayMode && !isManageMode && !item.pinned,
    [isAssistantDisplayMode, isManageMode]
  )

  const canDropTopicItem = useCallback(
    ({ targetGroupId }: { targetGroupId: string }) =>
      isAssistantDisplayMode &&
      !isManageMode &&
      targetGroupId !== TOPIC_PINNED_GROUP_ID &&
      targetGroupId !== TOPIC_UNKNOWN_ASSISTANT_GROUP_ID &&
      resolveAssistantIdForTopicGroup(targetGroupId, assistantById) !== undefined,
    [assistantById, isAssistantDisplayMode, isManageMode]
  )

  const canDragTopicGroup = useCallback(
    (group: { id: string }) => {
      if (!isAssistantDisplayMode || isManageMode) return false

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      return !!assistantId && assistantById.has(assistantId)
    },
    [assistantById, isAssistantDisplayMode, isManageMode]
  )

  const canDropTopicGroup = useCallback(
    ({
      activeGroupId,
      overGroupId
    }: {
      activeGroupId: string
      overGroupId: string
      overType: 'group' | 'item'
      sourceIndex: number
      targetIndex: number
    }) => {
      if (!isAssistantDisplayMode || isManageMode) return false

      const activeAssistantId = getAssistantIdFromTopicGroupId(activeGroupId)
      const overAssistantId = getAssistantIdFromTopicGroupId(overGroupId)

      return (
        !!activeAssistantId &&
        !!overAssistantId &&
        assistantById.has(activeAssistantId) &&
        assistantById.has(overAssistantId)
      )
    },
    [assistantById, isAssistantDisplayMode, isManageMode]
  )

  const handleTopicReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (!isAssistantDisplayMode || isManageMode) return

      if (payload.type === 'group') {
        const activeAssistantId = getAssistantIdFromTopicGroupId(payload.activeGroupId)
        const overAssistantId = getAssistantIdFromTopicGroupId(payload.overGroupId)

        if (
          !activeAssistantId ||
          !overAssistantId ||
          !assistantById.has(activeAssistantId) ||
          !assistantById.has(overAssistantId)
        ) {
          return
        }

        const assistantIds = orderedAssistants.map((assistant) => assistant.id)
        const nextAssistantIds = moveAssistantGroupAfterDrop(assistantIds, activeAssistantId, overAssistantId, payload)
        const anchor = buildAssistantGroupDropAnchor(payload, overAssistantId)

        setOptimisticAssistantOrderIds(nextAssistantIds)

        try {
          await dataApiService.patch(`/assistants/${activeAssistantId}/order`, {
            body: anchor
          })
          await refreshAssistants()
        } catch (err) {
          setOptimisticAssistantOrderIds(null)
          logger.error('Failed to reorder assistant topic group', { activeAssistantId, err, overAssistantId })

          try {
            await refreshAssistants()
          } catch (refreshErr) {
            logger.error('Failed to refresh assistants after group reorder failure', {
              activeAssistantId,
              refreshErr
            })
          }
        }

        return
      }

      if (payload.sourceGroupId === TOPIC_PINNED_GROUP_ID || payload.targetGroupId === TOPIC_PINNED_GROUP_ID) return
      if (payload.targetGroupId === TOPIC_UNKNOWN_ASSISTANT_GROUP_ID) return

      const topic = topics.find((candidate) => candidate.id === payload.activeId)
      if (!topic || topic.pinned) return

      const targetAssistantId = resolveAssistantIdForTopicGroup(payload.targetGroupId, assistantById)
      if (targetAssistantId === undefined) return

      const normalizedPayload = normalizeTopicDropPayload(payload)
      const anchor = buildTopicDropAnchor(normalizedPayload)
      const currentAssistantId = topic.assistantId ?? null
      setOptimisticMove({ payload: normalizedPayload, targetAssistantId })

      try {
        if (targetAssistantId !== currentAssistantId) {
          await dataApiService.patch(`/topics/${payload.activeId}`, {
            body: { assistantId: targetAssistantId }
          })
        }

        await dataApiService.patch(`/topics/${payload.activeId}/order`, {
          body: anchor
        })
        await refreshTopics()
      } catch (err) {
        setOptimisticMove(null)
        logger.error('Failed to reorder topic by assistant group', { err, topicId: payload.activeId })
        if (targetAssistantId !== currentAssistantId) {
          try {
            await refreshTopics()
          } catch (refreshErr) {
            logger.error('Failed to refresh topics after partial assistant move', {
              refreshErr,
              topicId: payload.activeId
            })
          }
        }
      }
    },
    [assistantById, isAssistantDisplayMode, isManageMode, orderedAssistants, refreshAssistants, refreshTopics, topics]
  )

  return (
    <>
      <TopicResourceList<Topic>
        items={filteredTopics}
        status={listStatus}
        selectedId={isManageMode ? null : activeTopic?.id}
        estimateItemSize={() => 34}
        groupBy={topicGroupBy}
        collapsedGroupIds={collapsedTopicGroupIds}
        revealRequest={revealRequest}
        defaultGroupVisibleCount={5}
        groupLoadStep={5}
        getGroupHeaderAction={getGroupHeaderAction}
        getGroupHeaderIcon={getGroupHeaderIcon}
        dragCapabilities={{
          groups: isAssistantDisplayMode && !isManageMode,
          items: isAssistantDisplayMode && !isManageMode,
          itemSameGroup: isAssistantDisplayMode && !isManageMode,
          itemCrossGroup: isAssistantDisplayMode && !isManageMode
        }}
        canDragGroup={canDragTopicGroup}
        canDropGroup={canDropTopicGroup}
        canDragItem={canDragTopicItem}
        canDropItem={canDropTopicItem}
        groupShowMoreLabel={t('chat.topics.group.show_more')}
        groupCollapseLabel={t('chat.topics.group.collapse')}
        onRenameItem={handleRenameTopic}
        onReorder={handleTopicReorder}
        onCollapsedGroupIdsChange={handleCollapsedTopicGroupIdsChange}>
        <ResourceList.Header
          icon={<Clock3 size={12} />}
          title={t('chat.topics.title')}
          count={topics.length}
          className="gap-1 pb-0"
          actions={
            <>
              <TopicDisplayModeMenu mode={displayMode} onChange={(nextMode) => void setTopicDisplayMode(nextMode)} />
              <Tooltip title={t('chat.topics.manage.title')} delay={500}>
                <ResourceList.HeaderActionButton
                  type="button"
                  aria-label={t('chat.topics.manage.title')}
                  aria-pressed={isManageMode}
                  className={cn(isManageMode && 'text-foreground')}
                  onClick={isManageMode ? exitManageMode : enterManageMode}>
                  <ListChecks size={12} className="block" />
                </ResourceList.HeaderActionButton>
              </Tooltip>
              <ResourceList.HeaderActionButton
                type="button"
                aria-label={onOpenHistory ? t('history.records.title') : t('shortcut.general.toggle_sidebar')}
                onClick={handleOpenHistoryOrToggleSidebar}>
                <ChevronsUpDown size={12} className="block rotate-45" />
              </ResourceList.HeaderActionButton>
            </>
          }>
          <ResourceList.Search placeholder={t('chat.topics.search.placeholder')} />
          <Button
            type="button"
            variant="ghost"
            aria-label={t('chat.add.topic.title')}
            className="h-7 w-full justify-start gap-1.5 rounded-md px-2.5 text-[12px] font-normal text-muted-foreground/70 shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground"
            onClick={() => void EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC)}>
            <Plus size={13} className="block shrink-0" />
            <span className="truncate">{t('chat.add.topic.title')}</span>
          </Button>
        </ResourceList.Header>

        <TopicListBody
          activeTopic={activeTopic}
          deletingTopicId={deletingTopicId}
          exportMenuOptions={exportMenuOptions as TopicExportMenuOptions}
          isNewlyRenamed={isNewlyRenamed}
          isRenaming={isRenaming}
          listRef={listRef}
          notesPath={notesPath}
          onAutoRename={handleAutoRename}
          onClearMessages={handleClearMessages}
          onConfirmDelete={handleConfirmDelete}
          onDeleteClick={handleDeleteClick}
          onDeleteFromMenu={handleDeleteTopicFromMenu}
          onPinTopic={handlePinTopic}
          onSwitchTopic={setActiveTopic}
          rowLayout={singlealone ? 'single' : 'grouped'}
          selectedIds={selectedIds}
          toggleSelectTopic={toggleSelectTopic}
          topicsLength={topics.length}
          variant={isManageMode ? 'manage' : isAssistantDisplayMode ? 'draggable' : 'plain'}
        />
      </TopicResourceList>

      <TopicManagePanel
        topics={topics}
        activeTopic={activeTopic}
        setActiveTopic={setActiveTopic}
        manageState={manageState}
        filteredTopics={filteredTopics}
      />
    </>
  )
}

type TopicListBodyVariant = 'manage' | 'draggable' | 'plain'
type TopicRowLayout = 'grouped' | 'single'
type TopicRowMode = 'manage' | 'default'
type TopicStreamState = {
  isFulfilled: boolean
  isPending: boolean
}

type TopicStreamStatusSnapshot = {
  signature: string
  value: ReadonlyMap<string, TopicStreamState>
}

const EMPTY_TOPIC_STREAM_STATE: TopicStreamState = Object.freeze({
  isFulfilled: false,
  isPending: false
})

const EMPTY_TOPIC_STREAM_STATUS_MAP: ReadonlyMap<string, TopicStreamState> = new Map()

const getTopicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as const

const getTopicStreamSeenCacheKey = (topicId: string) => `topic.stream.seen.${topicId}` as const

const buildTopicStreamStatusSnapshot = (topicIds: readonly string[]): TopicStreamStatusSnapshot => {
  if (topicIds.length === 0) {
    return {
      signature: '',
      value: EMPTY_TOPIC_STREAM_STATUS_MAP
    }
  }

  const value = new Map<string, TopicStreamState>()
  const signatureParts: string[] = []

  for (const topicId of topicIds) {
    const statusEntry = cacheService.getShared(getTopicStreamStatusCacheKey(topicId))
    const seen = cacheService.get(getTopicStreamSeenCacheKey(topicId)) ?? false
    const status = statusEntry?.status
    const streamStatus = {
      isFulfilled: status === 'done' && !seen,
      isPending: status === 'pending' || status === 'streaming'
    }

    signatureParts.push(`${topicId}:${streamStatus.isPending ? 1 : 0}:${streamStatus.isFulfilled ? 1 : 0}`)

    if (streamStatus.isPending || streamStatus.isFulfilled) {
      value.set(topicId, streamStatus)
    }
  }

  return {
    signature: signatureParts.join('|'),
    value: value.size > 0 ? value : EMPTY_TOPIC_STREAM_STATUS_MAP
  }
}

const subscribeTopicStreamStatuses = (topicIds: readonly string[], onStoreChange: () => void): (() => void) => {
  if (topicIds.length === 0) {
    return () => undefined
  }

  const unsubscribes: Array<() => void> = []

  for (const topicId of new Set(topicIds)) {
    unsubscribes.push(cacheService.subscribe(getTopicStreamStatusCacheKey(topicId), onStoreChange))
    unsubscribes.push(cacheService.subscribe(getTopicStreamSeenCacheKey(topicId), onStoreChange))
  }

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
  }
}

const useTopicListStreamStatuses = (topicIds: readonly string[]): ReadonlyMap<string, TopicStreamState> => {
  const snapshotRef = useRef<TopicStreamStatusSnapshot>({
    signature: '',
    value: EMPTY_TOPIC_STREAM_STATUS_MAP
  })

  const getSnapshot = useCallback(() => {
    const nextSnapshot = buildTopicStreamStatusSnapshot(topicIds)

    if (snapshotRef.current.signature === nextSnapshot.signature) {
      return snapshotRef.current.value
    }

    snapshotRef.current = nextSnapshot
    return nextSnapshot.value
  }, [topicIds])

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeTopicStreamStatuses(topicIds, onStoreChange),
    [topicIds]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

interface TopicListBodyProps {
  activeTopic: Topic
  deletingTopicId: string | null
  exportMenuOptions: TopicExportMenuOptions
  isNewlyRenamed: (topicId: string) => boolean
  isRenaming: (topicId: string) => boolean
  listRef: RefObject<HTMLDivElement | null>
  notesPath: string
  onAutoRename: (topic: Topic) => Promise<void>
  onClearMessages: (topic: Topic) => void
  onConfirmDelete: (topic: Topic, event?: MouseEvent) => Promise<void>
  onDeleteClick: (topicId: string, event: MouseEvent) => void
  onDeleteFromMenu: (topic: Topic) => Promise<void>
  onPinTopic: (topic: Topic) => Promise<void>
  onSwitchTopic: (topic: Topic) => void
  rowLayout: TopicRowLayout
  selectedIds: Set<string>
  toggleSelectTopic: (topicId: string) => void
  topicsLength: number
  variant: TopicListBodyVariant
}

function TopicListBody(props: TopicListBodyProps) {
  const { t } = useTranslation()
  const context = useResourceList<Topic>()
  const { listRef, rowLayout, variant, ...rowProps } = props
  const visibleItems = context.view.items
  const visibleTopicIds = useMemo(() => visibleItems.map((topic) => topic.id), [visibleItems])
  const streamStatusByTopicId = useTopicListStreamStatuses(visibleTopicIds)

  if (context.state.status === 'loading') {
    return <ResourceList.LoadingState />
  }

  if (context.state.status === 'error') {
    return <ResourceList.ErrorState message={t('error.boundary.default.message')} />
  }

  if (context.view.items.length === 0) {
    return <ResourceList.EmptyState />
  }

  const renderItem = (topic: Topic) => (
    <TopicRow
      key={topic.id}
      topic={topic}
      {...rowProps}
      layout={rowLayout}
      mode={variant === 'manage' ? 'manage' : 'default'}
      streamStatus={streamStatusByTopicId.get(topic.id) ?? EMPTY_TOPIC_STREAM_STATE}
    />
  )

  if (variant === 'manage') {
    return <ResourceList.VirtualItems ref={listRef} className="pb-[76px]" renderItem={renderItem} />
  }

  if (variant === 'draggable') {
    return <ResourceList.VirtualDraggableItems ref={listRef} className="pt-0 pb-3" renderItem={renderItem} />
  }

  return <ResourceList.VirtualItems ref={listRef} className="pt-0 pb-3" renderItem={renderItem} />
}

type TopicRowSharedProps = Omit<TopicListBodyProps, 'listRef' | 'rowLayout' | 'variant'> & {
  layout: TopicRowLayout
  mode: TopicRowMode
}

interface TopicRowWithStatusProps extends TopicRowSharedProps {
  topic: Topic
}

interface TopicRowProps extends TopicRowWithStatusProps {
  streamStatus: TopicStreamState
}

function TopicRow({
  activeTopic,
  deletingTopicId,
  exportMenuOptions,
  isNewlyRenamed,
  isRenaming,
  layout,
  mode,
  notesPath,
  onAutoRename,
  onClearMessages,
  onConfirmDelete,
  onDeleteClick,
  onDeleteFromMenu,
  onPinTopic,
  onSwitchTopic,
  selectedIds,
  streamStatus,
  toggleSelectTopic,
  topic,
  topicsLength
}: TopicRowProps) {
  const { t } = useTranslation()
  const context = useResourceList<Topic>()
  const isManageMode = mode === 'manage'
  const isActive = topic.id === activeTopic?.id
  const isSelected = selectedIds.has(topic.id)
  const canSelect = !topic.pinned
  const topicName = topic.name.replace('`', '')
  const nameAnimationClassName = isRenaming(topic.id)
    ? 'animation-shimmer'
    : isNewlyRenamed(topic.id)
      ? 'animation-reveal'
      : ''
  const { isFulfilled: isTopicStreamFulfilled, isPending: isTopicStreamPending } = streamStatus
  const hasTopicStreamIndicator = !isActive && (isTopicStreamPending || isTopicStreamFulfilled)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const startInlineRename = useCallback(() => context.actions.startRename(topic.id), [context.actions, topic.id])
  const startMenuRename = useCallback(() => setRenameDialogOpen(true), [])
  const submitRenameDialog = useCallback(
    (name: string) => context.actions.commitRename(topic.id, name),
    [context.actions, topic.id]
  )
  const { menuActions, handleMenuAction } = useTopicMenuActions({
    exportMenuOptions,
    isRenaming: isRenaming(topic.id),
    notesPath,
    onAutoRename,
    onClearMessages,
    onDelete: onDeleteFromMenu,
    onPinTopic,
    onStartRename: startMenuRename,
    t,
    topic,
    topicsLength
  })

  const row = (
    <ResourceList.Item
      item={topic}
      data-testid="topic-list-row"
      className={cn(
        'relative',
        isManageMode && isSelected && 'bg-sidebar-accent shadow-[inset_0_0_0_1px_var(--color-sidebar-active-border)]',
        isManageMode && !canSelect && 'cursor-not-allowed opacity-50',
        layout === 'grouped' && !isManageMode && isActive && 'bg-sidebar-accent',
        layout === 'single' && !isManageMode && isActive && 'bg-sidebar-accent shadow-none',
        layout === 'single' && !isManageMode && !isActive && 'hover:bg-(--color-background-soft)'
      )}
      style={{ cursor: isManageMode && !canSelect ? 'not-allowed' : 'pointer' }}
      onMouseEnter={() =>
        prefetch(`/topics/${topic.id}/messages`, {
          query: { limit: 999, includeSiblings: true }
        })
      }
      onClick={() => {
        if (isManageMode) {
          if (canSelect) {
            toggleSelectTopic(topic.id)
          }
          return
        }

        onSwitchTopic(topic)
      }}>
      {isManageMode && (
        <ResourceList.ItemIcon className={cn('mr-0.5', !canSelect && 'opacity-50')}>
          {isSelected ? (
            <CheckSquare size={16} className="text-(--color-primary)" />
          ) : (
            <Square size={16} className="text-(--color-text-3)" />
          )}
        </ResourceList.ItemIcon>
      )}
      {!isManageMode && (
        <Tooltip title={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
          <ResourceList.ItemLeadingAction
            aria-label={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
            className={cn(topic.pinned && 'text-muted-foreground/55 hover:text-muted-foreground/75')}
            onClick={(event) => {
              event.stopPropagation()
              void onPinTopic(topic)
            }}>
            <PinIcon size={13} className={cn(topic.pinned && '-rotate-45')} />
          </ResourceList.ItemLeadingAction>
        </Tooltip>
      )}
      <ResourceList.RenameField
        item={topic}
        aria-label={t('chat.topics.edit.title')}
        autoFocus
        onClick={(event) => event.stopPropagation()}
      />
      {context.state.renamingId !== topic.id && (
        <ResourceList.ItemTitle
          title={topicName}
          className={nameAnimationClassName}
          onDoubleClick={(event) => {
            if (isManageMode) return
            event.stopPropagation()
            startInlineRename()
          }}>
          {topicName}
        </ResourceList.ItemTitle>
      )}
      {hasTopicStreamIndicator ? (
        <TopicStreamIndicator isFulfilled={isTopicStreamFulfilled} isPending={isTopicStreamPending} />
      ) : !topic.pinned ? (
        <Tooltip
          placement="bottom"
          delay={700}
          title={
            <span className="text-xs italic opacity-80">
              {t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
            </span>
          }>
          <ResourceList.ItemAction
            aria-label={t('common.delete')}
            data-deleting={deletingTopicId === topic.id}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey || deletingTopicId === topic.id) {
                void onConfirmDelete(topic, event)
                return
              }
              onDeleteClick(topic.id, event)
            }}>
            {deletingTopicId === topic.id ? <Trash2 size={14} className="text-(--color-error)" /> : <XIcon size={14} />}
          </ResourceList.ItemAction>
        </Tooltip>
      ) : null}
    </ResourceList.Item>
  )

  if (isManageMode) {
    return row
  }

  return (
    <>
      <ResourceList.ContextMenu item={topic} actions={menuActions} onAction={handleMenuAction}>
        {row}
      </ResourceList.ContextMenu>
      <EditNameDialog
        open={renameDialogOpen}
        title={t('chat.topics.edit.title')}
        initialName={topic.name}
        placeholder={t('chat.topics.edit.placeholder')}
        onSubmit={submitRenameDialog}
        onOpenChange={setRenameDialogOpen}
      />
    </>
  )
}

const TopicStreamIndicator = ({ isFulfilled, isPending }: { isFulfilled: boolean; isPending: boolean }) => {
  const dotClassName = cn(
    'animation-pulse size-[5px] rounded-full',
    isPending ? 'bg-(--color-status-warning)' : 'bg-(--color-status-success)'
  )

  if (isPending) {
    return (
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center"
        data-testid="topic-stream-indicator">
        <span className={dotClassName} />
      </span>
    )
  }

  if (isFulfilled) {
    return (
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center opacity-100 group-hover:opacity-100"
        data-testid="topic-stream-indicator">
        <span className={dotClassName} />
      </span>
    )
  }

  return null
}
