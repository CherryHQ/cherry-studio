import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ActionMenu } from '@renderer/components/chat/actions/ActionMenu'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
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
import { isMac } from '@renderer/config/constant'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import { prefetch } from '@renderer/data/hooks/useDataApi'
import { useAssistantsApi } from '@renderer/hooks/useAssistant'
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
import {
  isTopicStreamTurnSeen,
  type TopicStreamSeenValue,
  useTopicStreamStatus
} from '@renderer/hooks/useTopicStreamStatus'
import { buildLibraryEditSearch, buildLibraryRouteUrl } from '@renderer/pages/library/routeSearch'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import {
  Bot,
  CheckSquare,
  Edit3,
  ListFilter,
  MoreHorizontal,
  PinIcon,
  PinOffIcon,
  Square,
  SquareMinus,
  SquarePen,
  Trash2,
  XIcon
} from 'lucide-react'
import type { MouseEvent, RefObject } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { buildChatMessageRouteUrl } from '../../routeSearch'
import type { AddNewTopicPayload } from '../../types'
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
  TOPIC_PINNED_GROUP_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
  type TopicDisplayMode
} from './Topics.helpers'
import { useTopicMenuActions } from './useTopicMenuActions'

const logger = loggerService.withContext('Topics')

interface Props {
  activeTopic: Topic
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  revealRequest?: ResourceListRevealRequest
  setActiveTopic: (topic: Topic) => void
}

const TOPIC_DISPLAY_OPTIONS: TopicDisplayMode[] = ['time', 'assistant']

function buildCreateTopicPayload(
  topic: Topic | null | undefined,
  assistantById?: ReadonlyMap<string, unknown>
): AddNewTopicPayload | undefined {
  if (!topic) return undefined

  const assistantId = topic.assistantId
  return { assistantId: assistantId && assistantById?.has(assistantId) ? assistantId : null }
}

function findLatestCreateTopicPayload(
  topics: readonly Topic[],
  predicate: (topic: Topic) => boolean = () => true,
  assistantById?: ReadonlyMap<string, unknown>
): AddNewTopicPayload | undefined {
  let latestTopic: Topic | null = null
  let latestUpdatedAtMs = Number.NEGATIVE_INFINITY

  for (const topic of topics) {
    if (topic.pinned || !predicate(topic)) continue

    const parsedUpdatedAtMs = Date.parse(topic.updatedAt)
    const updatedAtMs = Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : Number.NEGATIVE_INFINITY
    if (!latestTopic || updatedAtMs > latestUpdatedAtMs) {
      latestTopic = topic
      latestUpdatedAtMs = updatedAtMs
    }
  }

  return buildCreateTopicPayload(latestTopic, assistantById)
}

type AssistantGroupActionId = 'assistant-group.edit' | 'assistant-group.toggle-pin' | 'assistant-group.delete-topics'
type AssistantGroupAction = ResolvedAction & { id: AssistantGroupActionId; label: string }

function resolveAssistantGroupActions({
  disabled,
  pinned,
  t
}: {
  disabled?: boolean
  pinned: boolean
  t: ReturnType<typeof useTranslation>['t']
}): AssistantGroupAction[] {
  return [
    {
      id: 'assistant-group.edit' satisfies AssistantGroupActionId,
      label: t('assistants.edit.title'),
      icon: <Edit3 size={14} />,
      danger: false,
      availability: { visible: true, enabled: true },
      children: []
    },
    {
      id: 'assistant-group.toggle-pin' satisfies AssistantGroupActionId,
      label: pinned ? t('assistants.unpin.title') : t('assistants.pin.title'),
      icon: pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />,
      danger: false,
      availability: { visible: true, enabled: !disabled },
      children: []
    },
    {
      id: 'assistant-group.delete-topics' satisfies AssistantGroupActionId,
      label: t('assistants.clear.menu_title'),
      icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
      group: 'danger',
      danger: true,
      availability: { visible: true, enabled: true },
      children: []
    }
  ]
}

function AssistantGroupMoreDropdownMenuContent({
  actions,
  onAction
}: {
  actions: readonly AssistantGroupAction[]
  onAction: (action: AssistantGroupAction) => void
}) {
  return (
    <>
      {actions.map((action) => (
        <DropdownMenuItem
          key={action.id}
          disabled={!action.availability.enabled}
          variant={action.danger ? 'destructive' : 'default'}
          onSelect={(event) => {
            event.stopPropagation()
            onAction(action)
          }}>
          {action.icon}
          <span>{action.label}</span>
        </DropdownMenuItem>
      ))}
    </>
  )
}

function resolveAssistantIdForTopicGroup(
  groupId: string,
  assistantById: ReadonlyMap<string, unknown>
): string | null | undefined {
  const assistantId = getAssistantIdFromTopicGroupId(groupId)
  if (!assistantId || !assistantById.has(assistantId)) {
    return undefined
  }

  return assistantId
}

function TopicListOptionsMenu({
  mode,
  onChange,
  isManageMode,
  onToggleManageMode,
  onOpenHistory
}: {
  mode: TopicDisplayMode
  onChange: (mode: TopicDisplayMode) => void
  isManageMode: boolean
  onToggleManageMode: () => void
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceList.HeaderActionButton type="button" aria-label={t('chat.topics.display.title')}>
          <ListFilter className="block" />
        </ResourceList.HeaderActionButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-32 rounded-lg border-border p-1 shadow-lg">
        <MenuList className="gap-0.5">
          <div className="px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground/60">
            {t('chat.topics.display.title')}
          </div>
          {TOPIC_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              label={t(`chat.topics.display.${option}`)}
              active={mode === option}
              className="h-6 rounded-lg px-1.5 py-0 font-normal text-[11px] text-muted-foreground/75 hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
            />
          ))}
          <MenuDivider className="my-0.5" />
          <MenuItem
            label={t('chat.topics.manage.title')}
            active={isManageMode}
            className="h-6 rounded-lg px-1.5 py-0 font-normal text-[11px] text-muted-foreground/75 hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
            onClick={() => {
              onToggleManageMode()
              setOpen(false)
            }}
          />
          {onOpenHistory && (
            <>
              <MenuItem
                label={t('history.records.shortTitle')}
                className="h-6 rounded-lg px-1.5 py-0 font-normal text-[11px] text-muted-foreground/75 hover:bg-accent hover:text-foreground"
                onClick={(event) => {
                  onOpenHistory(event.currentTarget.getBoundingClientRect())
                  setOpen(false)
                }}
              />
            </>
          )}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

function AssistantGroupMoreMenu({
  assistantId,
  disabled,
  pinned,
  onDeleteAllTopics,
  onEdit,
  onTogglePin
}: {
  assistantId: string
  disabled?: boolean
  pinned: boolean
  onDeleteAllTopics: (assistantId: string) => void | Promise<void>
  onEdit: (assistantId: string) => void
  onTogglePin: (assistantId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actions = resolveAssistantGroupActions({ disabled, pinned, t })
  const handleAction = (action: AssistantGroupAction) => {
    if (action.id === 'assistant-group.edit') {
      window.requestAnimationFrame(() => onEdit(assistantId))
      return
    }
    if (action.id === 'assistant-group.toggle-pin') {
      void onTogglePin(assistantId)
      return
    }
    if (action.id === 'assistant-group.delete-topics') {
      void onDeleteAllTopics(assistantId)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ResourceList.GroupHeaderActionButton
          type="button"
          aria-label={t('common.more')}
          onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal className="block" />
        </ResourceList.GroupHeaderActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom">
        <AssistantGroupMoreDropdownMenuContent actions={actions} onAction={handleAction} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Topics({ activeTopic, onNewTopic, onOpenHistory, revealRequest, setActiveTopic }: Props) {
  const { t } = useTranslation()
  const tabs = useOptionalTabsContext()
  const [groupNow] = useState(() => dayjs())
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById, refreshTopics } = useTopicMutations()
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [collapsedTopicGroupIds, setCollapsedTopicGroupIds] = usePreference('topic.tab.collapsed_group_ids')
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
  const displayMode = topicDisplayMode ?? 'time'
  const isAssistantDisplayMode = displayMode === 'assistant'

  const {
    isLoading: isTopicPinsLoading,
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
  const {
    isLoading: isAssistantPinsLoading,
    isMutating: isAssistantPinsMutating,
    isRefreshing: isAssistantPinsRefreshing,
    pinnedIds: assistantPinnedIds,
    togglePin: toggleAssistantPin
  } = usePins('assistant', { enabled: isAssistantDisplayMode })
  const assistantPinnedIdSet = useMemo(() => new Set(assistantPinnedIds), [assistantPinnedIds])
  const isAssistantPinActionDisabled = isAssistantPinsLoading || isAssistantPinsRefreshing || isAssistantPinsMutating
  const { topics: apiTopics, isLoadingAll, isFullyLoaded, error } = useTopics({ loadAll: true })
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
  const { isManageMode, selectedIds, searchText, enterManageMode, exitManageMode, setSelectedIds, toggleSelectTopic } =
    manageState
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
            unlinked: t('chat.topics.group.unknown_assistant')
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
  const headerCreateTopicPayload = useMemo(
    () => findLatestCreateTopicPayload(filteredTopics, undefined, assistantById),
    [assistantById, filteredTopics]
  )
  const getCreateTopicPayloadForGroup = useCallback(
    (groupId: string) =>
      findLatestCreateTopicPayload(filteredTopics, (topic) => topicGroupBy(topic)?.id === groupId, assistantById),
    [assistantById, filteredTopics, topicGroupBy]
  )
  const handleGroupHeaderSelectTopic = useCallback(
    (topicId: string) => {
      const topic = filteredTopics.find((candidate) => candidate.id === topicId)
      if (topic && topic.id !== activeTopic?.id) {
        setActiveTopic(topic)
      }
    },
    [activeTopic?.id, filteredTopics, setActiveTopic]
  )
  const getGroupHeaderClickBehavior = useCallback(
    (group: { id: string }) =>
      displayMode === 'assistant' && !isManageMode && group.id !== TOPIC_PINNED_GROUP_ID
        ? 'select-first-then-toggle'
        : 'toggle',
    [displayMode, isManageMode]
  )

  const listError = error || (isAssistantDisplayMode ? assistantsError : undefined)
  const listLoading =
    isLoadingAll ||
    !isFullyLoaded ||
    isTopicPinsLoading ||
    (isAssistantDisplayMode && (isAssistantsLoading || isAssistantPinsLoading))
  const visibleFilteredTopics = useMemo(() => (listLoading ? [] : filteredTopics), [filteredTopics, listLoading])
  const listStatus = listError ? 'error' : listLoading ? 'loading' : filteredTopics.length === 0 ? 'empty' : 'idle'
  const openAssistantEditor = useCallback(
    (assistantId: string) => {
      tabs?.openTab(buildLibraryRouteUrl(buildLibraryEditSearch('assistant', assistantId)), { forceNew: true })
    },
    [tabs]
  )
  const openTopicInNewTab = useCallback(
    (topic: Topic) => {
      tabs?.openTab(buildChatMessageRouteUrl(topic.id), {
        forceNew: true,
        title: topic.name || t('common.unnamed')
      })
    },
    [tabs, t]
  )

  const handleToggleAssistantPin = useCallback(
    async (assistantId: string) => {
      if (isAssistantPinActionDisabled) return

      try {
        await toggleAssistantPin(assistantId)
        await refreshAssistants()
      } catch (err) {
        logger.error('Failed to toggle assistant pin from topic group', { assistantId, err })
        window.toast.error(t('common.error'))
      }
    },
    [isAssistantPinActionDisabled, refreshAssistants, t, toggleAssistantPin]
  )

  const handleDeleteAssistantTopics = useCallback(
    async (assistantId: string) => {
      const targetTopics = topics.filter((topic) => topic.assistantId === assistantId)
      if (targetTopics.length === 0) return

      const targetTopicIds = new Set(targetTopics.map((topic) => topic.id))
      const remainingTopics = topics.filter((topic) => !targetTopicIds.has(topic.id))
      if (remainingTopics.length === 0) {
        window.toast.error(t('chat.topics.manage.error.at_least_one'))
        return
      }

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

      const results = await Promise.allSettled(targetTopics.map((topic) => removeTopic(topic).then(() => topic.id)))
      const successfulIds = new Set(
        results
          .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
          .map((result) => result.value)
      )

      const actualRemainingTopics = topics.filter((topic) => !successfulIds.has(topic.id))
      if (successfulIds.has(activeTopic.id) && actualRemainingTopics.length > 0) {
        setActiveTopic(actualRemainingTopics[0])
      }

      if (successfulIds.size === targetTopics.length) {
        window.toast.success(t('chat.topics.manage.delete.success', { count: successfulIds.size }))
      } else if (successfulIds.size > 0) {
        window.toast.warning(
          t('chat.topics.manage.delete.partial_success', {
            failedCount: targetTopics.length - successfulIds.size,
            successCount: successfulIds.size
          })
        )
      } else {
        window.toast.error(t('chat.topics.manage.delete.error'))
      }

      await refreshTopics()
    },
    [activeTopic.id, refreshTopics, removeTopic, setActiveTopic, t, topics]
  )

  const getGroupHeaderAction = useCallback(
    (group: { id: string }) => {
      let assistantGroupId: string | undefined

      if (group.id === TOPIC_PINNED_GROUP_ID) return null

      if (displayMode !== 'time') {
        const assistantId = getAssistantIdFromTopicGroupId(group.id)
        if (assistantId && assistantById.has(assistantId)) {
          assistantGroupId = assistantId
        }

        if (!assistantGroupId) return null
      }

      const payload = getCreateTopicPayloadForGroup(group.id)
      if (!payload && !assistantGroupId) return null

      return (
        <>
          {assistantGroupId && (
            <Tooltip title={t('common.more')} delay={500}>
              <AssistantGroupMoreMenu
                assistantId={assistantGroupId}
                disabled={isAssistantPinActionDisabled}
                pinned={assistantPinnedIdSet.has(assistantGroupId)}
                onDeleteAllTopics={handleDeleteAssistantTopics}
                onEdit={openAssistantEditor}
                onTogglePin={handleToggleAssistantPin}
              />
            </Tooltip>
          )}
          {payload && (
            <Tooltip title={t('chat.conversation.new')} delay={500}>
              <ResourceList.GroupHeaderActionButton
                type="button"
                aria-label={t('chat.conversation.new')}
                onClick={() => void onNewTopic?.(payload)}>
                <SquarePen className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )}
        </>
      )
    },
    [
      assistantById,
      assistantPinnedIdSet,
      displayMode,
      getCreateTopicPayloadForGroup,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      onNewTopic,
      openAssistantEditor,
      t
    ]
  )

  const getGroupHeaderContextMenu = useCallback(
    (group: { id: string }) => {
      if (displayMode !== 'assistant') return null

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      if (!assistantId || !assistantById.has(assistantId)) return null

      const actions = resolveAssistantGroupActions({
        disabled: isAssistantPinActionDisabled,
        pinned: assistantPinnedIdSet.has(assistantId),
        t
      })

      return (
        <ActionMenu
          actions={actions}
          onAction={(action) => {
            if (action.id === 'assistant-group.edit') {
              openAssistantEditor(assistantId)
              return
            }
            if (action.id === 'assistant-group.toggle-pin') {
              void handleToggleAssistantPin(assistantId)
              return
            }
            if (action.id === 'assistant-group.delete-topics') {
              void handleDeleteAssistantTopics(assistantId)
            }
          }}
        />
      )
    },
    [
      assistantById,
      assistantPinnedIdSet,
      displayMode,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      openAssistantEditor,
      t
    ]
  )

  const getGroupHeaderIcon = useCallback(
    (group: { id: string }) => {
      if (!isAssistantDisplayMode || group.id === TOPIC_PINNED_GROUP_ID) return undefined
      if (group.id === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) return null

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      const assistant = assistantId ? assistantById.get(assistantId) : undefined
      if (!assistant) return undefined

      return assistant.emoji ? <span className="text-[13px] leading-none">{assistant.emoji}</span> : <Bot size={13} />
    },
    [assistantById, isAssistantDisplayMode]
  )

  const getSelectableTopicIdsInGroup = useCallback(
    (groupId: string) =>
      filteredTopics
        .filter((topic) => !topic.pinned && (topicGroupBy(topic) ?? { id: 'ungrouped', label: '' }).id === groupId)
        .map((topic) => topic.id),
    [filteredTopics, topicGroupBy]
  )

  const toggleSelectTopicGroup = useCallback(
    (groupId: string) => {
      const topicIds = getSelectableTopicIdsInGroup(groupId)
      if (topicIds.length === 0) return

      setSelectedIds((previous) => {
        const allSelected = topicIds.every((topicId) => previous.has(topicId))
        const next = new Set(previous)

        for (const topicId of topicIds) {
          if (allSelected) {
            next.delete(topicId)
          } else {
            next.add(topicId)
          }
        }

        return next
      })
    },
    [getSelectableTopicIdsInGroup, setSelectedIds]
  )

  const getGroupHeaderLeadingAction = useCallback(
    (group: { id: string; label: string }) => {
      if (!isManageMode) return null

      const topicIds = getSelectableTopicIdsInGroup(group.id)
      const selectedCount = topicIds.filter((topicId) => selectedIds.has(topicId)).length
      const allSelected = topicIds.length > 0 && selectedCount === topicIds.length
      const partiallySelected = selectedCount > 0 && !allSelected
      const labelPrefix = allSelected ? t('chat.topics.manage.deselect_all') : t('common.select_all')

      return (
        <button
          type="button"
          aria-label={`${labelPrefix} ${group.label}`}
          aria-pressed={allSelected}
          disabled={topicIds.length === 0}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-lg text-foreground/70 outline-none transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0',
            'hover:text-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:cursor-not-allowed disabled:opacity-50',
            (allSelected || partiallySelected) && 'text-(--color-primary)'
          )}
          onClick={(event) => {
            event.stopPropagation()
            toggleSelectTopicGroup(group.id)
          }}>
          {allSelected ? <CheckSquare /> : partiallySelected ? <SquareMinus /> : <Square />}
        </button>
      )
    },
    [getSelectableTopicIdsInGroup, isManageMode, selectedIds, t, toggleSelectTopicGroup]
  )

  const handleCollapsedTopicGroupIdsChange = useCallback(
    (nextGroupIds: string[]) => void setCollapsedTopicGroupIds(nextGroupIds),
    [setCollapsedTopicGroupIds]
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
      targetGroupId !== TOPIC_UNLINKED_ASSISTANT_GROUP_ID &&
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
          window.toast.error(formatErrorMessageWithPrefix(err, t('assistants.reorder.error.failed')))

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
      if (payload.targetGroupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) return

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
    [
      assistantById,
      isAssistantDisplayMode,
      isManageMode,
      orderedAssistants,
      refreshAssistants,
      refreshTopics,
      t,
      topics
    ]
  )

  return (
    <>
      <TopicResourceList<Topic>
        items={visibleFilteredTopics}
        status={listStatus}
        selectedId={isManageMode ? null : activeTopic?.id}
        estimateItemSize={() => 34}
        groupBy={topicGroupBy}
        collapsedGroupIds={collapsedTopicGroupIds}
        revealRequest={revealRequest}
        defaultGroupVisibleCount={5}
        groupLoadStep={5}
        getGroupHeaderAction={getGroupHeaderAction}
        getGroupHeaderContextMenu={getGroupHeaderContextMenu}
        getGroupHeaderIcon={getGroupHeaderIcon}
        getGroupHeaderLeadingAction={getGroupHeaderLeadingAction}
        groupHeaderClickBehavior={getGroupHeaderClickBehavior}
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
        onGroupHeaderSelectItem={handleGroupHeaderSelectTopic}
        onReorder={handleTopicReorder}
        onCollapsedGroupIdsChange={handleCollapsedTopicGroupIdsChange}>
        <ResourceList.Header className="gap-1 px-1.5 pb-0">
          <ResourceList.HeaderItem
            type="button"
            aria-label={t('chat.conversation.new')}
            icon={<SquarePen />}
            label={t('chat.conversation.new')}
            onClick={() => void onNewTopic?.(headerCreateTopicPayload)}
            actions={
              <>
                <TopicListOptionsMenu
                  mode={displayMode}
                  onChange={(nextMode) => void setTopicDisplayMode(nextMode)}
                  isManageMode={isManageMode}
                  onToggleManageMode={isManageMode ? exitManageMode : enterManageMode}
                  onOpenHistory={onOpenHistory}
                />
              </>
            }
          />
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
          onEditAssistant={openAssistantEditor}
          onOpenInNewTab={tabs ? openTopicInNewTab : undefined}
          onPinTopic={handlePinTopic}
          onSwitchTopic={setActiveTopic}
          rowLayout="grouped"
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
    const seen = cacheService.getCasual<TopicStreamSeenValue>(getTopicStreamSeenCacheKey(topicId))
    const status = statusEntry?.status
    const hasSeenTurn = isTopicStreamTurnSeen(seen, statusEntry?.turnId)
    const streamStatus = {
      isFulfilled: status === 'done' && !hasSeenTurn,
      isPending: status === 'pending' || status === 'streaming'
    }

    signatureParts.push(
      `${topicId}:${statusEntry?.turnId ?? ''}:${hasSeenTurn ? 1 : 0}:${streamStatus.isPending ? 1 : 0}:${streamStatus.isFulfilled ? 1 : 0}`
    )

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
  onEditAssistant: (assistantId: string) => void
  onOpenInNewTab?: (topic: Topic) => void
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
  const visibleItems = context.view.visibleItems
  const visibleTopicIds = useMemo(() => visibleItems.map((topic) => topic.id), [visibleItems])
  const streamStatusByTopicId = useTopicListStreamStatuses(visibleTopicIds)

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

  return (
    <ResourceList.Body<Topic>
      listRef={listRef}
      draggable={variant === 'draggable'}
      virtualClassName={variant === 'manage' ? 'pb-[76px]' : 'pt-0 pb-3'}
      errorFallback={<ResourceList.ErrorState message={t('error.boundary.default.message')} />}
      renderItem={renderItem}
    />
  )
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
  onEditAssistant,
  onOpenInNewTab,
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
    onEditAssistant: (topic) => {
      if (topic.assistantId) {
        onEditAssistant(topic.assistantId)
      }
    },
    onOpenInNewTab,
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
        isManageMode &&
          isSelected &&
          'bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--color-sidebar-active-border)]',
        isManageMode && !canSelect && 'cursor-not-allowed opacity-50',
        layout === 'grouped' && !isManageMode && isActive && 'bg-accent text-foreground',
        layout === 'single' && !isManageMode && isActive && 'bg-accent text-foreground shadow-none'
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
        <ResourceList.ItemIcon className={cn(!canSelect && 'opacity-50')}>
          {isSelected ? (
            <CheckSquare size={16} className="text-(--color-primary)" />
          ) : (
            <Square size={16} className="text-foreground/70" />
          )}
        </ResourceList.ItemIcon>
      )}
      {!isManageMode && (
        <Tooltip title={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
          <ResourceList.ItemLeadingAction
            aria-label={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
            className={cn(topic.pinned && 'text-foreground/70 hover:text-foreground')}
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
      <ResourceListActionContextMenu item={topic} actions={menuActions} onAction={handleMenuAction}>
        {row}
      </ResourceListActionContextMenu>
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
    'size-[5px] rounded-full',
    isPending ? 'animation-pulse bg-(--color-status-warning)' : 'bg-(--color-status-success)'
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
