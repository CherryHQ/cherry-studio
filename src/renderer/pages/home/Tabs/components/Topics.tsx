import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { useCache, usePersistCache } from '@data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import {
  ResourceList,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  TopicResourceList,
  useResourceListActions,
  useResourceListPinnedState,
  useResourceListRowState
} from '@renderer/components/chat/resources'
import { CommandPopupMenu } from '@renderer/components/command'
import EditNameDialog from '@renderer/components/EditNameDialog'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ResourceEditDialogHost, type ResourceEditDialogTarget } from '@renderer/components/resource/dialogs'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import { useAssistantsApi } from '@renderer/hooks/useAssistant'
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
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import {
  Bot,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  ListFilter,
  MoreHorizontal,
  PinIcon,
  SquarePen,
  Trash2,
  XIcon
} from 'lucide-react'
import type { MouseEvent, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  rejectPendingTopicImageActions,
  requestTopicImageAction,
  type TopicImageActionRequest,
  type TopicImageActionType
} from '../../messages/topicImageActionBus'
import type { AddNewTopicPayload } from '../../types'
import {
  type AssistantGroupActionContext,
  executeAssistantGroupAction,
  resolveAssistantGroupActions
} from './assistantGroupActions'
import type { TopicExportMenuOptions } from './topicContextMenuActions'
import {
  applyOptimisticTopicDisplayMove,
  buildAssistantGroupDropAnchor,
  buildTopicDropAnchor,
  createTopicDisplayGroupResolver,
  getAssistantIdFromTopicGroupId,
  moveAssistantGroupAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups,
  TOPIC_ASSISTANT_SECTION_ID,
  TOPIC_PINNED_GROUP_ID,
  TOPIC_PINNED_SECTION_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
  type TopicDisplayMode
} from './topicsHelpers'
import { useTopicMenuActions } from './useTopicMenuActions'

const logger = loggerService.withContext('Topics')

interface Props {
  activeTopic?: Topic
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
  setActiveTopic: (topic: Topic) => void
}

const TOPIC_DISPLAY_OPTIONS: TopicDisplayMode[] = ['time', 'assistant']

const TOPIC_DISPLAY_ICONS: Record<TopicDisplayMode, ReactNode> = {
  time: <Clock size={16} />,
  assistant: <Bot size={16} />
}

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
  sectionId
}: {
  mode: TopicDisplayMode
  onChange: (mode: TopicDisplayMode) => void
  sectionId?: string
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
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 p-1">
        <MenuList>
          <div className="px-2.5 py-1 font-medium text-muted-foreground text-xs">{t('chat.topics.display.title')}</div>
          {TOPIC_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              size="sm"
              icon={TOPIC_DISPLAY_ICONS[option]}
              label={t(`chat.topics.display.${option}`)}
              active={mode === option}
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
            />
          ))}
          {sectionId && (
            <>
              <MenuDivider />
              <ResourceList.SectionToggleMenuItem
                size="sm"
                expandIcon={<ChevronsUpDown size={16} />}
                collapseIcon={<ChevronsDownUp size={16} />}
                sectionId={sectionId}
                expandLabel={t('chat.topics.group.expand_all')}
                collapseLabel={t('chat.topics.group.collapse_all')}
                onClick={() => {
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
  deleteTopicsDisabled,
  disabled,
  pinned,
  onDeleteAllTopics,
  onEdit,
  onTogglePin
}: {
  assistantId: string
  deleteTopicsDisabled?: boolean
  disabled?: boolean
  pinned: boolean
  onDeleteAllTopics: (assistantId: string) => void | Promise<void>
  onEdit: (assistantId: string) => void
  onTogglePin: (assistantId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionContext: AssistantGroupActionContext = {
    assistantId,
    deleteTopicsDisabled,
    disabled,
    onDeleteAllTopics,
    onEdit,
    onTogglePin,
    pinned,
    t
  }
  const actions = resolveAssistantGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeAssistantGroupAction(action, actionContext)
  })

  return (
    <CommandPopupMenu location="webcontents.context" extraItems={extraItems} align="end" side="bottom">
      <ResourceList.GroupHeaderActionButton
        type="button"
        aria-label={t('common.more')}
        onClick={(event) => event.stopPropagation()}>
        <MoreHorizontal className="block" />
      </ResourceList.GroupHeaderActionButton>
    </CommandPopupMenu>
  )
}

export function Topics({ activeTopic, onNewTopic, revealRequest, setActiveTopic }: Props) {
  const { t } = useTranslation()
  const tabs = useOptionalTabsContext()
  const conversationNav = useConversationNavigation('assistants')
  const [groupNow] = useState(() => dayjs())
  const { notesPath } = useNotesSettings()
  const {
    updateTopic: patchTopic,
    deleteTopic: deleteTopicById,
    deleteTopicsByAssistantId,
    refreshTopics
  } = useTopicMutations()
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [topicExpansionTime, setTopicExpansionTime] = usePersistCache('ui.topic.expansion.time')
  const [topicExpansionAssistant, setTopicExpansionAssistant] = usePersistCache('ui.topic.expansion.assistant')
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
  const topicExpansion = isAssistantDisplayMode ? topicExpansionAssistant : topicExpansionTime

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
  const defaultAssistant = useMemo(() => ({ name: t('chat.default.name'), emoji: DEFAULT_ASSISTANT_EMOJI }), [t])
  const listRef = useRef<HTMLDivElement>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const [deletingAssistantGroupId, setDeletingAssistantGroupId] = useState<string | null>(null)
  const deletingAssistantGroupIdRef = useRef<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const showTopicImageExportToast = useCallback(
    (request: TopicImageActionRequest) => {
      const key = `topic-image-export:${request.id}`
      const loadingPromise = request.promise.finally(() => window.toast.closeToast(key)).catch(() => undefined)

      window.toast.loading({
        key,
        title: t('chat.topics.export.image_exporting_keep_page'),
        promise: loadingPromise,
        onError: () => {}
      })

      void request.promise.then(
        () => window.toast.success(t('chat.topics.export.image_saved')),
        () => window.toast.error(t('chat.topics.export.failed'))
      )
    },
    [t]
  )

  const handleTopicImageAction = useCallback(
    (type: TopicImageActionType, topic: Topic) => {
      const request = requestTopicImageAction(type, topic)
      if (type === 'export') {
        showTopicImageExportToast(request)
      } else {
        void request.promise.catch(() => window.toast.error(t('common.copy_failed')))
      }

      if (topic.id !== activeTopic?.id) {
        setActiveTopic(topic)
      }
    },
    [activeTopic?.id, setActiveTopic, showTopicImageExportToast]
  )

  useEffect(() => {
    return () => rejectPendingTopicImageActions(undefined, new Error('Topic image export was cancelled'))
  }, [])

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
  const topicsRef = useRef(topics)
  const activeTopicIdRef = useRef(activeTopic?.id ?? '')

  useEffect(() => {
    topicsRef.current = topics
  }, [topics])

  useEffect(() => {
    activeTopicIdRef.current = activeTopic?.id ?? ''
  }, [activeTopic?.id])

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

  const { isFulfilled: isActiveTopicStreamFulfilled, markSeen: markActiveTopicStreamSeen } = useTopicStreamStatus(
    activeTopic?.id ?? ''
  )

  useEffect(() => {
    if (isActiveTopicStreamFulfilled) {
      markActiveTopicStreamSeen()
    }
  }, [isActiveTopicStreamFulfilled, markActiveTopicStreamSeen])

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

      if (topic.id === activeTopic?.id && topics.length > 1) {
        const index = findIndex(topics, (candidate) => candidate.id === topic.id)
        setActiveTopic(topics[index + 1 === topics.length ? index - 1 : index + 1])
      }
    },
    [activeTopic?.id, removeTopic, setActiveTopic, t, topics]
  )

  const handleDeleteTopicClick = useCallback((topicId: string, event: MouseEvent) => {
    event.stopPropagation()

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
    }

    setDeletingTopicId(topicId)
    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null
      setDeletingTopicId(null)
    }, 2000)
  }, [])

  const handleConfirmDeleteTopic = useCallback(
    async (topic: Topic, event?: MouseEvent) => {
      event?.stopPropagation()
      if (topics.length <= 1) {
        if (deleteTimerRef.current) {
          clearTimeout(deleteTimerRef.current)
          deleteTimerRef.current = null
        }
        setDeletingTopicId(null)
        return
      }
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current)
        deleteTimerRef.current = null
      }
      setDeletingTopicId(null)
      await handleDeleteTopicFromMenu(topic)
    },
    [handleDeleteTopicFromMenu, topics.length]
  )

  useEffect(
    () => () => {
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current)
      }
    },
    []
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
        defaultAssistant,
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
        now: groupNow,
        pinnedAsSection: isAssistantDisplayMode
      }),
    [assistantById, defaultAssistant, displayMode, groupNow, isAssistantDisplayMode, t]
  )

  const topicSectionBy = useMemo(() => {
    if (!isAssistantDisplayMode) return undefined

    return (topic: Topic): ResourceListSection => {
      if (topic.pinned) {
        return { id: TOPIC_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      }

      return { id: TOPIC_ASSISTANT_SECTION_ID, label: t('chat.topics.display.assistant') }
    }
  }, [isAssistantDisplayMode, t])

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

  const filteredTopics = groupedTopics
  const headerCreateTopicPayload = useMemo(
    () => (isAssistantDisplayMode ? findLatestCreateTopicPayload(filteredTopics, undefined, assistantById) : undefined),
    [assistantById, filteredTopics, isAssistantDisplayMode]
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
      displayMode === 'assistant' && group.id !== TOPIC_PINNED_GROUP_ID ? 'select-first-then-toggle' : 'toggle',
    [displayMode]
  )
  const listError = error || (isAssistantDisplayMode ? assistantsError : undefined)
  const listLoading =
    isLoadingAll ||
    !isFullyLoaded ||
    isTopicPinsLoading ||
    (isAssistantDisplayMode && (isAssistantsLoading || isAssistantPinsLoading))
  const visibleFilteredTopics = useMemo(() => (listLoading ? [] : filteredTopics), [filteredTopics, listLoading])
  const listStatus = listError ? 'error' : listLoading ? 'loading' : filteredTopics.length === 0 ? 'empty' : 'idle'
  const openAssistantEditor = useCallback((assistantId: string) => {
    setEditDialogTarget({ kind: 'assistant', id: assistantId })
  }, [])
  const openTopicInNewTab = useCallback(
    (topic: Topic) => {
      conversationNav.openConversationTab(topic.id, topic.name, { forceNew: true })
    },
    [conversationNav, t]
  )
  const openTopicInNewWindow = useCallback(
    (topic: Topic) => {
      conversationNav.openConversationWindow(topic.id, topic.name)
    },
    [conversationNav, t]
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
      if (deletingAssistantGroupIdRef.current) return

      const targetTopics = topicsRef.current.filter((topic) => topic.assistantId === assistantId)
      if (targetTopics.length === 0) return

      const targetTopicIds = new Set(targetTopics.map((topic) => topic.id))
      const remainingTopics = topicsRef.current.filter((topic) => !targetTopicIds.has(topic.id))
      if (remainingTopics.length === 0) {
        window.toast.error(t('chat.topics.manage.error.at_least_one'))
        return
      }

      deletingAssistantGroupIdRef.current = assistantId
      setDeletingAssistantGroupId(assistantId)

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

        const latestTargetTopicIds = new Set(
          topicsRef.current.filter((topic) => topic.assistantId === assistantId).map((topic) => topic.id)
        )
        if (latestTargetTopicIds.size === 0) return

        const latestRemainingTopics = topicsRef.current.filter((topic) => !latestTargetTopicIds.has(topic.id))
        if (latestRemainingTopics.length === 0) {
          window.toast.error(t('chat.topics.manage.error.at_least_one'))
          return
        }

        const result = await deleteTopicsByAssistantId(assistantId)
        const successfulIds = new Set(result.deletedIds)
        const actualRemainingTopics = topicsRef.current.filter((topic) => !successfulIds.has(topic.id))
        if (successfulIds.has(activeTopicIdRef.current) && actualRemainingTopics.length > 0) {
          setActiveTopic(actualRemainingTopics[0])
        }

        window.toast.success(t('chat.topics.manage.delete.success', { count: result.deletedCount }))
        await refreshTopics()
      } catch (err) {
        logger.error('Failed to delete assistant topics', { assistantId, err })
        window.toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        deletingAssistantGroupIdRef.current = null
        setDeletingAssistantGroupId(null)
      }
    },
    [deleteTopicsByAssistantId, refreshTopics, setActiveTopic, t]
  )

  const getGroupHeaderAction = useCallback(
    (group: { id: string }) => {
      let assistantGroupId: string | undefined

      if (group.id === TOPIC_PINNED_GROUP_ID) return null
      if (displayMode === 'time') return null

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      if (assistantId && assistantById.has(assistantId)) {
        assistantGroupId = assistantId
      }

      if (!assistantGroupId) return null

      const payload = getCreateTopicPayloadForGroup(group.id)
      if (!payload && !assistantGroupId) return null

      return (
        <>
          {assistantGroupId && (
            <Tooltip title={t('common.more')} delay={500}>
              <AssistantGroupMoreMenu
                assistantId={assistantGroupId}
                deleteTopicsDisabled={
                  deletingAssistantGroupId !== null || !topics.some((topic) => topic.assistantId === assistantGroupId)
                }
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
                onClick={(event) => {
                  event.stopPropagation()
                  void onNewTopic?.(payload)
                }}>
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
      deletingAssistantGroupId,
      displayMode,
      getCreateTopicPayloadForGroup,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      onNewTopic,
      openAssistantEditor,
      t,
      topics
    ]
  )

  const getGroupHeaderContextMenu = useCallback(
    (group: { id: string }) => {
      if (displayMode !== 'assistant') return null

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      if (!assistantId || !assistantById.has(assistantId)) return null

      const actionContext: AssistantGroupActionContext = {
        assistantId,
        deleteTopicsDisabled:
          deletingAssistantGroupId !== null || !topics.some((topic) => topic.assistantId === assistantId),
        disabled: isAssistantPinActionDisabled,
        onDeleteAllTopics: handleDeleteAssistantTopics,
        onEdit: openAssistantEditor,
        onTogglePin: handleToggleAssistantPin,
        pinned: assistantPinnedIdSet.has(assistantId),
        t
      }
      const actions = resolveAssistantGroupActions(actionContext)

      return actionsToCommandMenuExtraItems(actions, (action) => {
        void executeAssistantGroupAction(action, actionContext)
      })
    },
    [
      assistantById,
      assistantPinnedIdSet,
      deletingAssistantGroupId,
      displayMode,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      openAssistantEditor,
      t,
      topics
    ]
  )

  const getGroupHeaderIcon = useCallback(
    (group: { id: string; label: string }) => {
      if (!isAssistantDisplayMode || group.id === TOPIC_PINNED_GROUP_ID) return undefined
      if (group.id === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) {
        if (group.label !== defaultAssistant.name) return null

        return defaultAssistant.emoji ? (
          <EmojiIcon emoji={defaultAssistant.emoji} size={24} fontSize={14} className="mr-0" />
        ) : (
          <Bot size={14} />
        )
      }

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      const assistant = assistantId ? assistantById.get(assistantId) : undefined
      if (!assistant) return undefined

      return assistant.emoji ? (
        <EmojiIcon emoji={assistant.emoji} size={24} fontSize={14} className="mr-0" />
      ) : (
        <Bot size={14} />
      )
    },
    [assistantById, defaultAssistant.emoji, defaultAssistant.name, isAssistantDisplayMode]
  )

  const collapsedTopicState = topicExpansion
  const handleTopicCollapsedStateChange = useCallback(
    (nextCollapsedIds: string[]) => {
      if (isAssistantDisplayMode) setTopicExpansionAssistant(nextCollapsedIds)
      else setTopicExpansionTime(nextCollapsedIds)
    },
    [isAssistantDisplayMode, setTopicExpansionAssistant, setTopicExpansionTime]
  )
  const canDragTopicItem = useCallback(
    ({ item }: { item: Topic }) => isAssistantDisplayMode && !item.pinned,
    [isAssistantDisplayMode]
  )

  const canDropTopicItem = useCallback(
    ({ targetGroupId }: { targetGroupId: string }) =>
      isAssistantDisplayMode &&
      targetGroupId !== TOPIC_PINNED_GROUP_ID &&
      targetGroupId !== TOPIC_UNLINKED_ASSISTANT_GROUP_ID &&
      resolveAssistantIdForTopicGroup(targetGroupId, assistantById) !== undefined,
    [assistantById, isAssistantDisplayMode]
  )

  const canDragTopicGroup = useCallback(
    (group: { id: string }) => {
      if (!isAssistantDisplayMode) return false

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      return !!assistantId && assistantById.has(assistantId)
    },
    [assistantById, isAssistantDisplayMode]
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
      if (!isAssistantDisplayMode) return false

      const activeAssistantId = getAssistantIdFromTopicGroupId(activeGroupId)
      const overAssistantId = getAssistantIdFromTopicGroupId(overGroupId)

      return (
        !!activeAssistantId &&
        !!overAssistantId &&
        assistantById.has(activeAssistantId) &&
        assistantById.has(overAssistantId)
      )
    },
    [assistantById, isAssistantDisplayMode]
  )

  const handleTopicReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (!isAssistantDisplayMode) return

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
    [assistantById, isAssistantDisplayMode, orderedAssistants, refreshAssistants, refreshTopics, t, topics]
  )

  return (
    <>
      <TopicResourceList<Topic>
        items={visibleFilteredTopics}
        status={listStatus}
        selectedId={activeTopic?.id}
        groupBy={topicGroupBy}
        sectionBy={topicSectionBy}
        collapsedState={collapsedTopicState}
        revealRequest={revealRequest}
        defaultGroupVisibleCount={5}
        groupLoadStep={5}
        getGroupHeaderAction={getGroupHeaderAction}
        getGroupHeaderContextMenu={getGroupHeaderContextMenu}
        getGroupHeaderIcon={getGroupHeaderIcon}
        groupHeaderClickBehavior={getGroupHeaderClickBehavior}
        dragCapabilities={{
          groups: isAssistantDisplayMode,
          items: isAssistantDisplayMode,
          itemSameGroup: isAssistantDisplayMode,
          itemCrossGroup: isAssistantDisplayMode
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
        onCollapsedStateChange={handleTopicCollapsedStateChange}>
        <ResourceList.Header className="gap-1">
          <ResourceList.HeaderItem
            type="button"
            command="topic.create"
            aria-label={t('chat.conversation.new')}
            icon={<SquarePen />}
            label={t('chat.conversation.new')}
            onClick={() => void onNewTopic?.(headerCreateTopicPayload)}
            actions={
              <>
                <TopicListOptionsMenu
                  mode={displayMode}
                  onChange={(nextMode) => void setTopicDisplayMode(nextMode)}
                  sectionId={isAssistantDisplayMode ? TOPIC_ASSISTANT_SECTION_ID : undefined}
                />
              </>
            }
          />
        </ResourceList.Header>

        <TopicListBody
          activeTopic={activeTopic}
          deletingTopicId={deletingTopicId}
          displayMode={displayMode}
          exportMenuOptions={exportMenuOptions as TopicExportMenuOptions}
          isNewlyRenamed={isNewlyRenamed}
          isRenaming={isRenaming}
          listRef={listRef}
          notesPath={notesPath}
          onAutoRename={handleAutoRename}
          onClearMessages={handleClearMessages}
          onConfirmDelete={handleConfirmDeleteTopic}
          onDeleteClick={handleDeleteTopicClick}
          onDeleteFromMenu={handleDeleteTopicFromMenu}
          onOpenInNewTab={tabs ? openTopicInNewTab : undefined}
          onOpenInNewWindow={tabs ? openTopicInNewWindow : undefined}
          onPinTopic={handlePinTopic}
          onRequestTopicImageAction={handleTopicImageAction}
          onSwitchTopic={setActiveTopic}
          topicsLength={topics.length}
          variant={isAssistantDisplayMode ? 'draggable' : 'plain'}
        />
      </TopicResourceList>

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

type TopicListBodyVariant = 'draggable' | 'plain'
type TopicStreamState = {
  isFulfilled: boolean
  isPending: boolean
}

type TopicStreamStatusSnapshot = {
  signature: string
  value: TopicStreamState
}

const EMPTY_TOPIC_STREAM_STATE: TopicStreamState = Object.freeze({
  isFulfilled: false,
  isPending: false
})

const getTopicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as const

const getTopicStreamLastSeenCompletionCacheKey = (topicId: string) =>
  `topic.stream.last_seen_completion.${topicId}` as const

const buildTopicStreamStatusSnapshot = (topicId: string): TopicStreamStatusSnapshot => {
  const statusEntry = cacheService.getShared(getTopicStreamStatusCacheKey(topicId))
  const lastSeenCompletion = cacheService.getShared(getTopicStreamLastSeenCompletionCacheKey(topicId))
  const status = statusEntry?.status
  const lastCompletedAt = statusEntry?.lastCompletedAt ?? null
  const streamStatus = {
    isFulfilled: status === 'done' && lastCompletedAt !== lastSeenCompletion,
    isPending: status === 'pending' || status === 'streaming'
  }

  return {
    signature: `${topicId}:${status ?? ''}:${lastCompletedAt ?? ''}:${lastSeenCompletion ?? ''}:${streamStatus.isPending ? 1 : 0}:${streamStatus.isFulfilled ? 1 : 0}`,
    value: streamStatus.isPending || streamStatus.isFulfilled ? streamStatus : EMPTY_TOPIC_STREAM_STATE
  }
}

const subscribeTopicStreamStatus = (topicId: string, onStoreChange: () => void): (() => void) => {
  const unsubscribes = [
    cacheService.subscribe(getTopicStreamStatusCacheKey(topicId), onStoreChange),
    cacheService.subscribe(getTopicStreamLastSeenCompletionCacheKey(topicId), onStoreChange)
  ]

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
  }
}

const useTopicListStreamStatus = (topicId: string): TopicStreamState => {
  const snapshotRef = useRef<TopicStreamStatusSnapshot>({
    signature: '',
    value: EMPTY_TOPIC_STREAM_STATE
  })

  const getSnapshot = useCallback(() => {
    const nextSnapshot = buildTopicStreamStatusSnapshot(topicId)

    if (snapshotRef.current.signature === nextSnapshot.signature) {
      return snapshotRef.current.value
    }

    snapshotRef.current = nextSnapshot
    return nextSnapshot.value
  }, [topicId])

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeTopicStreamStatus(topicId, onStoreChange),
    [topicId]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

interface TopicListBodyProps {
  activeTopic?: Topic
  deletingTopicId: string | null
  displayMode: TopicDisplayMode
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
  onOpenInNewTab?: (topic: Topic) => void
  onOpenInNewWindow?: (topic: Topic) => void
  onPinTopic: (topic: Topic) => Promise<void>
  onRequestTopicImageAction: (type: TopicImageActionType, topic: Topic) => void
  onSwitchTopic: (topic: Topic) => void
  topicsLength: number
  variant: TopicListBodyVariant
}

type TopicRowSharedProps = Omit<TopicListBodyProps, 'listRef' | 'variant'>

function TopicListBody(props: TopicListBodyProps) {
  const { t } = useTranslation()
  const {
    activeTopic,
    deletingTopicId,
    displayMode,
    exportMenuOptions,
    isNewlyRenamed,
    isRenaming,
    listRef,
    notesPath,
    onAutoRename,
    onClearMessages,
    onConfirmDelete,
    onDeleteClick,
    onDeleteFromMenu,
    onOpenInNewTab,
    onOpenInNewWindow,
    onPinTopic,
    onRequestTopicImageAction,
    onSwitchTopic,
    topicsLength,
    variant
  } = props

  const rowProps = useMemo<TopicRowSharedProps>(
    () => ({
      activeTopic,
      deletingTopicId,
      displayMode,
      exportMenuOptions,
      isNewlyRenamed,
      isRenaming,
      notesPath,
      onAutoRename,
      onClearMessages,
      onConfirmDelete,
      onDeleteClick,
      onDeleteFromMenu,
      onOpenInNewTab,
      onOpenInNewWindow,
      onPinTopic,
      onRequestTopicImageAction,
      onSwitchTopic,
      topicsLength
    }),
    [
      activeTopic,
      deletingTopicId,
      displayMode,
      exportMenuOptions,
      isNewlyRenamed,
      isRenaming,
      notesPath,
      onAutoRename,
      onClearMessages,
      onConfirmDelete,
      onDeleteClick,
      onDeleteFromMenu,
      onOpenInNewTab,
      onOpenInNewWindow,
      onPinTopic,
      onRequestTopicImageAction,
      onSwitchTopic,
      topicsLength
    ]
  )

  const renderItem = useCallback((topic: Topic) => <TopicRow key={topic.id} topic={topic} {...rowProps} />, [rowProps])

  return (
    <ResourceList.Body<Topic>
      listRef={listRef}
      draggable={variant === 'draggable'}
      virtualClassName="pt-0 pb-3"
      errorFallback={<ResourceList.ErrorState message={t('error.boundary.default.message')} />}
      emptyFallback={
        <ResourceList.EmptyState
          compact
          preset="no-topic"
          className="min-h-60 px-5 py-10"
          title={t('chat.topics.empty.title')}
          description={t('chat.topics.empty.description')}
        />
      }
      renderItem={renderItem}
    />
  )
}

interface TopicRowWithStatusProps extends TopicRowSharedProps {
  topic: Topic
}

type TopicRowProps = TopicRowWithStatusProps

function TopicRow({
  activeTopic,
  deletingTopicId,
  displayMode,
  exportMenuOptions,
  isNewlyRenamed,
  isRenaming,
  notesPath,
  onAutoRename,
  onClearMessages,
  onConfirmDelete,
  onDeleteClick,
  onDeleteFromMenu,
  onOpenInNewTab,
  onOpenInNewWindow,
  onPinTopic,
  onRequestTopicImageAction,
  onSwitchTopic,
  topic,
  topicsLength
}: TopicRowProps) {
  const { t } = useTranslation()
  const actions = useResourceListActions()
  const rowState = useResourceListRowState(topic.id)
  const streamStatus = useTopicListStreamStatus(topic.id)
  const isActive = topic.id === activeTopic?.id
  const topicName = topic.name.replace('`', '')
  const nameAnimationClassName = isRenaming(topic.id)
    ? 'animation-shimmer'
    : isNewlyRenamed(topic.id)
      ? 'animation-reveal'
      : ''
  const { isFulfilled: isTopicStreamFulfilled, isPending: isTopicStreamPending } = streamStatus
  const hasTopicStreamIndicator = !isActive && (isTopicStreamPending || isTopicStreamFulfilled)
  const showPinAction = !rowState.renaming
  const showLeadingSlot = displayMode !== 'time' && !topic.pinned
  const isConfirmingDeletion = deletingTopicId === topic.id
  const canDeleteTopic = topicsLength > 1 && !topic.pinned
  const showDeleteOrStreamAction = hasTopicStreamIndicator || canDeleteTopic
  // Reserve right-padding for the title sized to the hover actions and stream indicator.
  const trailingActionCount = (showPinAction ? 1 : 0) + (showDeleteOrStreamAction ? 1 : 0)
  const topicTrailingActionPaddingClassName =
    trailingActionCount >= 3
      ? 'group-focus-within:pr-16 group-hover:pr-16 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-16'
      : trailingActionCount === 2
        ? 'group-focus-within:pr-12 group-hover:pr-12 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-12'
        : trailingActionCount === 1
          ? 'group-focus-within:pr-7 group-hover:pr-7 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-7'
          : ''
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const startInlineRename = useCallback(() => actions.startRename(topic.id), [actions, topic.id])
  const startMenuRename = useCallback(() => setRenameDialogOpen(true), [])
  const submitRenameDialog = useCallback((name: string) => actions.commitRename(topic.id, name), [actions, topic.id])
  const { menuActions, handleMenuAction } = useTopicMenuActions({
    exportMenuOptions,
    isActiveInCurrentTab: isActive,
    isRenaming: isRenaming(topic.id),
    notesPath,
    onAutoRename,
    onClearMessages,
    onCopyImage: (topic) => onRequestTopicImageAction('copy', topic),
    onDelete: onDeleteFromMenu,
    onExportImage: (topic) => onRequestTopicImageAction('export', topic),
    onOpenInNewTab,
    onOpenInNewWindow,
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
      className="relative"
      style={{ cursor: 'pointer' }}
      onClick={() => {
        onSwitchTopic(topic)
      }}>
      {showLeadingSlot && <ResourceList.ItemLeadingSlot className="relative" />}
      <ResourceList.RenameField
        item={topic}
        aria-label={t('chat.topics.edit.title')}
        autoFocus
        onClick={(event) => event.stopPropagation()}
      />
      {!rowState.renaming && (
        <ResourceList.ItemTitle
          title={topicName}
          className={cn(nameAnimationClassName, 'transition-[padding]', topicTrailingActionPaddingClassName)}
          onDoubleClick={(event) => {
            event.stopPropagation()
            startInlineRename()
          }}>
          {topicName}
        </ResourceList.ItemTitle>
      )}
      <ResourceList.ItemActions active={hasTopicStreamIndicator || isConfirmingDeletion}>
        {showPinAction && (
          <Tooltip title={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
            <ResourceList.ItemAction
              aria-label={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
              className={cn(topic.pinned && 'text-foreground/70 hover:text-foreground')}
              onClick={(event) => {
                event.stopPropagation()
                void onPinTopic(topic)
              }}>
              <PinIcon size={13} className={cn('size-3.25!', topic.pinned && '-rotate-45')} />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
        {hasTopicStreamIndicator ? (
          <TopicStreamIndicator isFulfilled={isTopicStreamFulfilled} isPending={isTopicStreamPending} />
        ) : canDeleteTopic ? (
          <Tooltip title={t('common.delete')} delay={500}>
            <ResourceList.ItemAction
              aria-label={t('common.delete')}
              data-deleting={isConfirmingDeletion}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey || isConfirmingDeletion) {
                  void onConfirmDelete(topic, event)
                  return
                }
                onDeleteClick(topic.id, event)
              }}>
              {isConfirmingDeletion ? (
                <Trash2 size={14} className="size-3.5! text-destructive" />
              ) : (
                <XIcon size={14} className="size-3.5!" />
              )}
            </ResourceList.ItemAction>
          </Tooltip>
        ) : null}
      </ResourceList.ItemActions>
    </ResourceList.Item>
  )

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
    'size-1.25 rounded-full',
    isPending ? 'animation-pulse bg-(--color-warning)' : 'bg-(--color-success)'
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
