import { Tooltip } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useCache, usePersistCache, useSharedCacheSelector } from '@data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import type {
  TopicExportMenuOptions,
  TopicMoveAssistantTarget
} from '@renderer/components/chat/actions/topicContextMenuActions'
import { useOptionalShellActions, useOptionalShellState } from '@renderer/components/chat/panes/Shell'
import {
  type ConversationResourceMenuItem,
  renderAssistantEntityIcon,
  resolveDefaultCollapsedGroupIds,
  RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS,
  ResourceList,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  TopicListOptionsMenu,
  useResourceListActions,
  useResourceListPinnedState,
  useResourceListRowState
} from '@renderer/components/chat/resourceList/base'
import { TopicResourceList } from '@renderer/components/chat/resourceList/TopicResourceList'
import { CommandPopupMenu } from '@renderer/components/command'
import EditNameDialog from '@renderer/components/EditNameDialog'
import type { ResourceEditDialogTarget } from '@renderer/components/resourceCatalog/dialogs/edit'
import { useTopicMenuActions } from '@renderer/hooks/chat/useTopicMenuActions'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs, useOptionalTabsContext } from '@renderer/hooks/tab'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useImageCaptureTargets } from '@renderer/hooks/useImageCaptureTargets'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePins } from '@renderer/hooks/usePins'
import {
  finishTopicRenaming,
  getTopicMessages,
  mapApiTopicToRendererTopic,
  startTopicRenaming,
  useTopicMutations
} from '@renderer/hooks/useTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import {
  applyOptimisticTopicDisplayMove,
  buildAssistantGroupDropAnchor,
  buildTopicDropAnchor,
  createTopicDisplayGroupResolver,
  getAssistantIdFromTopicGroupId,
  getTopicAssistantDisplayGroupId,
  moveAssistantGroupAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups,
  TOPIC_ASSISTANT_SECTION_ID,
  TOPIC_PINNED_GROUP_ID,
  TOPIC_PINNED_SECTION_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
  type TopicDisplayMode
} from '@renderer/utils/chat/topicsHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { pickNeighbourAfterRemoval } from '@renderer/utils/resourceEntity'
import { cn } from '@renderer/utils/style'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { AssistantIconType, TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import dayjs from 'dayjs'
import { MoreHorizontal, PinIcon, Plus, SquarePen, Trash2, XIcon } from 'lucide-react'
import type { MouseEvent, RefObject } from 'react'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  rejectPendingTopicImageActions,
  requestTopicImageAction,
  type TopicImageActionRequest,
  type TopicImageActionType
} from '../../messages/topicImageActionBus'
import TopicImageCaptureHost from '../../messages/TopicImageCaptureHost'
import type { AddNewTopicPayload, AddNewTopicWithReusePayload } from '../../types'
import {
  type AssistantGroupActionContext,
  executeAssistantGroupAction,
  resolveAssistantGroupActions
} from './assistantGroupActions'

const logger = loggerService.withContext('Topics')
const ResourceEditDialogHost = lazy(() =>
  import('@renderer/components/resourceCatalog/dialogs/edit').then((module) => ({
    default: module.ResourceEditDialogHost
  }))
)
// Let the context menu close before mounting the heavier offscreen message list.
const IMAGE_CAPTURE_START_DELAY_MS = 160

const EMPTY_COLLAPSED_TOPIC_STATE: readonly string[] = []
const DEFAULT_TOPIC_GROUP_VISIBLE_COUNT = 5
const LEFT_PANEL_TIME_TOPIC_GROUP_VISIBLE_COUNT = 50
const TOPIC_ASSISTANT_TAG_SECTION_PREFIX = 'topic:section:assistant-tag:'
const TOPIC_ASSISTANT_UNTAGGED_SECTION_ID = `${TOPIC_ASSISTANT_TAG_SECTION_PREFIX}untagged`
const TOPIC_EXPORT_MENU_PREFERENCE_KEYS = {
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
} as const

interface Props {
  activeTopic?: Topic
  assistantTopicsSource: AssistantTopicsSource
  assistantIdFilter?: string | null
  historyRecordsActive?: boolean
  onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
  onAddAssistant?: () => void | Promise<void>
  onCreateTopicAfterClear?: (payload: AddNewTopicPayload) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicWithReusePayload) => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  panePosition?: TopicTabPosition
  presentation?: 'sidebar' | 'right-panel'
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  setActiveTopic: (topic: Topic) => void
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

function matchesAssistantFilter(topic: Topic, assistantIdFilter: string | null | undefined) {
  if (assistantIdFilter === undefined) return false
  if (assistantIdFilter === null) return !topic.assistantId
  return topic.assistantId === assistantIdFilter
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

function AssistantGroupMoreMenu({
  assistantId,
  assistantIconType,
  deleteAssistantDisabled,
  deleteTopicsDisabled,
  disabled,
  isTagGrouping,
  pinned,
  onDeleteAssistant,
  onDeleteAllTopics,
  onEdit,
  onSetAssistantIconType,
  onToggleTagGrouping,
  onTogglePin
}: {
  assistantId: string
  assistantIconType: AssistantIconType
  deleteAssistantDisabled?: boolean
  deleteTopicsDisabled?: boolean
  disabled?: boolean
  isTagGrouping: boolean
  pinned: boolean
  onDeleteAssistant: (assistantId: string) => void | Promise<void>
  onDeleteAllTopics: (assistantId: string) => void | Promise<void>
  onEdit: (assistantId: string) => void
  onSetAssistantIconType: (iconType: AssistantIconType) => void | Promise<void>
  onToggleTagGrouping: () => void | Promise<void>
  onTogglePin: (assistantId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionContext: AssistantGroupActionContext = {
    assistantId,
    assistantIconType,
    deleteAssistantDisabled,
    deleteTopicsDisabled,
    disabled,
    isTagGrouping,
    onDeleteAssistant,
    onDeleteAllTopics,
    onEdit,
    onSetAssistantIconType,
    onToggleTagGrouping,
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

export function Topics({
  activeTopic,
  assistantTopicsSource,
  assistantIdFilter,
  historyRecordsActive,
  onActiveAssistantDeleted,
  onAddAssistant,
  onCreateTopicAfterClear,
  onNewTopic,
  onOpenHistoryRecords,
  onSetPanePosition,
  panePosition,
  presentation = 'sidebar',
  revealRequest,
  resourceMenuItems,
  setActiveTopic
}: Props) {
  const { t } = useTranslation()
  const isRightPanel = presentation === 'right-panel'
  const tabs = useOptionalTabsContext()
  const conversationNav = useConversationNavigation('assistants')
  const isWindowFrame = useWindowFrame().mode === 'window'
  const [groupNow] = useState(() => dayjs())
  const { notesPath } = useNotesSettings()
  const {
    updateTopic: patchTopic,
    deleteTopic: deleteTopicById,
    deleteTopicsByAssistantId,
    refreshTopics
  } = useTopicMutations()
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [storedPanePosition, setStoredPanePosition] = usePreference('topic.tab.position')
  const [assistantIconType, setAssistantIconType] = usePreference('assistant.icon_type')
  const [assistantSortType, setAssistantSortType] = usePreference('assistant.tab.sort_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const resolvedPanePosition = panePosition ?? storedPanePosition
  const setResolvedPanePosition =
    panePosition === undefined ? (onSetPanePosition ?? setStoredPanePosition) : onSetPanePosition
  const isTagGrouping = assistantSortType === 'tags'
  const [topicExpansionTime, setTopicExpansionTime] = usePersistCache('ui.topic.expansion.time')
  const [topicExpansionAssistant, setTopicExpansionAssistant] = usePersistCache('ui.topic.expansion.assistant')
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
  const { queueTarget: queueImageCaptureTarget, targets: imageCaptureTargets } = useImageCaptureTargets<Topic>({
    cancelMessage: 'Topic image export was cancelled',
    delayMs: IMAGE_CAPTURE_START_DELAY_MS,
    rejectPendingActions: rejectPendingTopicImageActions
  })
  const [exportMenuOptions] = useMultiplePreferences(TOPIC_EXPORT_MENU_PREFERENCE_KEYS)
  const displayMode = isRightPanel ? 'time' : (topicDisplayMode ?? 'time')
  const defaultGroupVisibleCount = isRightPanel
    ? Number.POSITIVE_INFINITY
    : displayMode === 'time'
      ? LEFT_PANEL_TIME_TOPIC_GROUP_VISIBLE_COUNT
      : DEFAULT_TOPIC_GROUP_VISIBLE_COUNT
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
  } = usePins('assistant')
  const assistantPinnedIdSet = useMemo(() => new Set(assistantPinnedIds), [assistantPinnedIds])
  const isAssistantPinActionDisabled = isAssistantPinsLoading || isAssistantPinsRefreshing || isAssistantPinsMutating
  const { topics: apiTopics, isLoadingAll, isFullyLoaded, error } = assistantTopicsSource
  const {
    assistants,
    isLoading: isAssistantsLoading,
    error: assistantsError,
    refetch: refreshAssistants
  } = useAssistantsApi()
  const closeConversationTabs = useCloseConversationTabs()
  const { deleteAssistant } = useAssistantMutations()
  const defaultAssistant = useMemo(() => ({ name: t('chat.default.name'), emoji: DEFAULT_ASSISTANT_EMOJI }), [t])
  const listRef = useRef<HTMLDivElement>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const [deletingAssistantGroupId, setDeletingAssistantGroupId] = useState<string | null>(null)
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null)
  const deletingAssistantGroupIdRef = useRef<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const showTopicImageExportToast = useCallback(
    (request: TopicImageActionRequest) => {
      const key = `topic-image-export:${request.id}`
      const loadingPromise = request.promise.finally(() => toast.closeToast(key)).catch(() => undefined)

      toast.loading({
        key,
        title: t('chat.topics.export.image_exporting_keep_page'),
        promise: loadingPromise,
        onError: () => {}
      })

      void request.promise.then(
        () => toast.success(t('chat.topics.export.image_saved')),
        () => toast.error(t('chat.topics.export.failed'))
      )
    },
    [t]
  )

  const handleTopicImageAction = useCallback(
    (type: TopicImageActionType, topic: Topic) => {
      const request = requestTopicImageAction(type, topic, { emit: false })
      if (type === 'export') {
        showTopicImageExportToast(request)
      } else {
        void request.promise.catch(() => toast.error(t('common.copy_failed')))
      }

      queueImageCaptureTarget(request, topic)
    },
    [queueImageCaptureTarget, showTopicImageExportToast, t]
  )

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
  const activeTopicRef = useRef(activeTopic)
  const activeTopicIdRef = useRef(activeTopic?.id ?? '')

  useEffect(() => {
    topicsRef.current = topics
  }, [topics])

  useEffect(() => {
    activeTopicIdRef.current = activeTopic?.id ?? ''
  }, [activeTopic?.id])

  useEffect(() => {
    activeTopicRef.current = activeTopic
  }, [activeTopic])

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
  // Move destinations intentionally include only persisted assistants. The
  // unlinked "Default Assistant" group is a display fallback for orphaned data,
  // not a user-selectable target that clears topic ownership.
  const assistantMoveTargets = useMemo<TopicMoveAssistantTarget[]>(() => {
    const targets = orderedAssistants.map((assistant) => ({
      id: assistant.id,
      name: assistant.name,
      icon: renderAssistantEntityIcon(
        assistantIconType,
        {
          emoji: assistant.emoji,
          modelId: assistant.modelId,
          modelName: assistant.modelName
        },
        defaultModelId
      )
    }))

    return [
      ...targets.filter((assistant) => assistantPinnedIdSet.has(assistant.id)),
      ...targets.filter((assistant) => !assistantPinnedIdSet.has(assistant.id))
    ]
  }, [assistantIconType, assistantPinnedIdSet, defaultModelId, orderedAssistants])
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
      toast.success(t('common.saved'))
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

  const handleMoveTopicToAssistant = useCallback(
    async (topic: Topic, assistantId: string) => {
      if (topic.assistantId === assistantId) return

      try {
        await patchTopic(topic.id, { assistantId })
        const currentActiveTopic = activeTopicRef.current
        if (currentActiveTopic?.id === topic.id) {
          setActiveTopic({ ...currentActiveTopic, assistantId })
        }
        toast.success(t('chat.topics.manage.move.success', { count: 1 }))
      } catch (err) {
        logger.error('Failed to move topic to assistant', { assistantId, err, topicId: topic.id })
        toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
      }
    },
    [patchTopic, setActiveTopic, t]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: Topic) => {
      const assistantTopicsBeforeDelete = topicsRef.current.filter(
        (candidate) => candidate.assistantId === topic.assistantId
      )

      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        toast.error(message)
        return
      }

      if (topic.id !== activeTopicIdRef.current) return

      // Deleting the active topic selects a neighbour within the *same assistant* (both layouts), so
      // we never jump to an unrelated conversation. When that assistant has no other topic left, open
      // a fresh empty one for it instead of leaving the view stranded.
      const next = pickNeighbourAfterRemoval(assistantTopicsBeforeDelete, topic.id)
      if (next) {
        setActiveTopic(next)
        return
      }

      // Never let the fresh replacement reuse the topic we just deleted (stale candidate list).
      await onNewTopic?.({ assistantId: topic.assistantId ?? null, excludeReuseTopicId: topic.id })
    },
    [onNewTopic, removeTopic, setActiveTopic, t]
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
      // Deleting the last remaining topic is allowed: handleDeleteTopicFromMenu opens a fresh empty
      // one for the assistant afterwards, so we never strand the view on an empty list.
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current)
        deleteTimerRef.current = null
      }
      setDeletingTopicId(null)
      await handleDeleteTopicFromMenu(topic)
    },
    [handleDeleteTopicFromMenu]
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
          toast.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
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

      if (isTagGrouping) {
        const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
        const tag = assistant?.tags?.[0]?.name?.trim()

        return tag
          ? { id: `${TOPIC_ASSISTANT_TAG_SECTION_PREFIX}${encodeURIComponent(tag)}`, label: tag }
          : { id: TOPIC_ASSISTANT_UNTAGGED_SECTION_ID, label: t('assistants.tags.untagged') }
      }

      return { id: TOPIC_ASSISTANT_SECTION_ID, label: t('chat.topics.display.assistant') }
    }
  }, [assistantById, isAssistantDisplayMode, isTagGrouping, t])

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

  const filteredTopics = useMemo(() => {
    if (!isRightPanel) return groupedTopics
    return groupedTopics.filter((topic) => matchesAssistantFilter(topic, assistantIdFilter))
  }, [assistantIdFilter, groupedTopics, isRightPanel])
  const headerCreateTopicPayload = useMemo(
    () =>
      isRightPanel
        ? { assistantId: assistantIdFilter ?? null }
        : isAssistantDisplayMode
          ? findLatestCreateTopicPayload(filteredTopics, undefined, assistantById)
          : undefined,
    [assistantById, assistantIdFilter, filteredTopics, isAssistantDisplayMode, isRightPanel]
  )
  const headerCreateLabel = isAssistantDisplayMode ? t('chat.add.assistant.title') : t('chat.conversation.new')
  const handleHeaderCreate = isAssistantDisplayMode
    ? () => void onAddAssistant?.()
    : () => void onNewTopic?.(headerCreateTopicPayload)
  const showHeaderCreateItem = !(isAssistantDisplayMode && resolvedPanePosition === 'right')
  const getCreateTopicPayloadForGroup = useCallback(
    (groupId: string) =>
      findLatestCreateTopicPayload(filteredTopics, (topic) => topicGroupBy(topic)?.id === groupId, assistantById),
    [assistantById, filteredTopics, topicGroupBy]
  )
  const handleGroupHeaderSelectTopic = useCallback(
    (topicId: string) => {
      const topic = filteredTopics.find((candidate) => candidate.id === topicId)
      if (topic && (historyRecordsActive || topic.id !== activeTopicIdRef.current)) {
        setActiveTopic(topic)
      }
    },
    [filteredTopics, historyRecordsActive, setActiveTopic]
  )
  const getGroupHeaderClickBehavior = useCallback(
    (group: { id: string }) => {
      if (isRightPanel) return 'none'

      return displayMode === 'assistant' && group.id !== TOPIC_PINNED_GROUP_ID ? 'select-first-then-toggle' : 'toggle'
    },
    [displayMode, isRightPanel]
  )
  const listError = error || (isAssistantDisplayMode ? assistantsError : undefined)
  const listLoading =
    isLoadingAll ||
    !isFullyLoaded ||
    isTopicPinsLoading ||
    (isAssistantDisplayMode && (isAssistantsLoading || isAssistantPinsLoading))
  const visibleFilteredTopics = useMemo(() => (listLoading ? [] : filteredTopics), [filteredTopics, listLoading])
  const listStatus = listError ? 'error' : listLoading ? 'loading' : filteredTopics.length === 0 ? 'empty' : 'idle'
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const hasActiveCenterSurface = hasActiveResourceMenuItem || historyRecordsActive
  const manageAssistantsMenuItem = resourceMenuItems?.find((item) => item.id === 'assistant-resource-view')
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
        toast.error(t('common.error'))
      }
    },
    [isAssistantPinActionDisabled, refreshAssistants, t, toggleAssistantPin]
  )

  const handleDeleteAssistantTopics = useCallback(
    async (assistantId: string) => {
      if (deletingAssistantGroupIdRef.current) return

      const targetTopics = topicsRef.current.filter((topic) => topic.assistantId === assistantId)
      if (targetTopics.length === 0) return

      deletingAssistantGroupIdRef.current = assistantId
      setDeletingAssistantGroupId(assistantId)

      try {
        const confirmed = await popup.confirm({
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

        const result = await deleteTopicsByAssistantId(assistantId)
        await refreshTopics()
        await onCreateTopicAfterClear?.({ assistantId })
        toast.success(t('chat.topics.manage.delete.success', { count: result.deletedCount }))
      } catch (err) {
        logger.error('Failed to delete assistant topics', { assistantId, err })
        toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        deletingAssistantGroupIdRef.current = null
        setDeletingAssistantGroupId(null)
      }
    },
    [deleteTopicsByAssistantId, onCreateTopicAfterClear, refreshTopics, t]
  )

  const handleDeleteAssistant = useCallback(
    async (assistantId: string) => {
      if (deletingAssistantId) return

      setDeletingAssistantId(assistantId)
      try {
        const confirmed = await popup.confirm({
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

        const result = await deleteAssistant(assistantId, { deleteTopics: true })
        closeConversationTabs('assistants', result.deletedTopicIds ?? [])
        if (activeTopic?.assistantId === assistantId) {
          await onActiveAssistantDeleted?.(assistantId)
        }

        await refreshAssistants()
        await refreshTopics()
        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete assistant from topic group', { assistantId, err })
        toast.error(formatErrorMessageWithPrefix(err, t('common.delete_failed')))
      } finally {
        setDeletingAssistantId(null)
      }
    },
    [
      activeTopic?.assistantId,
      closeConversationTabs,
      deleteAssistant,
      deletingAssistantId,
      onActiveAssistantDeleted,
      refreshAssistants,
      refreshTopics,
      t
    ]
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
                assistantIconType={assistantIconType}
                deleteAssistantDisabled={deletingAssistantId !== null}
                deleteTopicsDisabled={
                  deletingAssistantGroupId !== null ||
                  deletingAssistantId !== null ||
                  !topics.some((topic) => topic.assistantId === assistantGroupId)
                }
                disabled={isAssistantPinActionDisabled}
                isTagGrouping={isTagGrouping}
                onDeleteAssistant={handleDeleteAssistant}
                pinned={assistantPinnedIdSet.has(assistantGroupId)}
                onDeleteAllTopics={handleDeleteAssistantTopics}
                onEdit={openAssistantEditor}
                onSetAssistantIconType={setAssistantIconType}
                onToggleTagGrouping={() => setAssistantSortType(isTagGrouping ? 'list' : 'tags')}
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
      assistantIconType,
      deletingAssistantId,
      deletingAssistantGroupId,
      displayMode,
      getCreateTopicPayloadForGroup,
      handleDeleteAssistant,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      isTagGrouping,
      onNewTopic,
      openAssistantEditor,
      setAssistantIconType,
      setAssistantSortType,
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
        assistantIconType,
        deleteAssistantDisabled: deletingAssistantId !== null,
        deleteTopicsDisabled:
          deletingAssistantGroupId !== null ||
          deletingAssistantId !== null ||
          !topics.some((topic) => topic.assistantId === assistantId),
        disabled: isAssistantPinActionDisabled,
        isTagGrouping,
        onDeleteAssistant: handleDeleteAssistant,
        onDeleteAllTopics: handleDeleteAssistantTopics,
        onEdit: openAssistantEditor,
        onSetAssistantIconType: setAssistantIconType,
        onToggleTagGrouping: () => setAssistantSortType(isTagGrouping ? 'list' : 'tags'),
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
      assistantIconType,
      assistantPinnedIdSet,
      deletingAssistantId,
      deletingAssistantGroupId,
      displayMode,
      handleDeleteAssistant,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      isTagGrouping,
      openAssistantEditor,
      setAssistantIconType,
      setAssistantSortType,
      t,
      topics
    ]
  )

  const getGroupHeaderIcon = useCallback(
    (group: { id: string; label: string }) => {
      if (!isAssistantDisplayMode || group.id === TOPIC_PINNED_GROUP_ID) return undefined
      if (group.id === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) {
        if (group.label !== defaultAssistant.name) return null

        return renderAssistantEntityIcon(assistantIconType, {
          emoji: defaultAssistant.emoji,
          modelId: defaultModelId
        })
      }

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      const assistant = assistantId ? assistantById.get(assistantId) : undefined
      if (!assistant) return undefined

      return renderAssistantEntityIcon(assistantIconType, {
        emoji: assistant.emoji,
        modelId: assistant.modelId ?? defaultModelId,
        modelName: assistant.modelName
      })
    },
    [
      assistantById,
      assistantIconType,
      defaultAssistant.emoji,
      defaultAssistant.name,
      defaultModelId,
      isAssistantDisplayMode
    ]
  )

  const collapsedTopicState = useMemo(
    () =>
      isRightPanel
        ? EMPTY_COLLAPSED_TOPIC_STATE
        : resolveDefaultCollapsedGroupIds({
            collapsedIds: topicExpansion,
            groupBy: topicGroupBy,
            items: filteredTopics
          }),
    [filteredTopics, isRightPanel, topicExpansion, topicGroupBy]
  )
  const handleTopicCollapsedStateChange = useCallback(
    (nextCollapsedIds: string[]) => {
      if (isRightPanel) return

      if (isAssistantDisplayMode) setTopicExpansionAssistant(nextCollapsedIds)
      else setTopicExpansionTime(nextCollapsedIds)
    },
    [isAssistantDisplayMode, isRightPanel, setTopicExpansionAssistant, setTopicExpansionTime]
  )
  const handleTopicDisplayModeChange = useCallback(
    (nextMode: TopicDisplayMode) => {
      if (nextMode === 'assistant') {
        const activeAssistantGroupId = activeTopic ? getTopicAssistantDisplayGroupId(activeTopic) : undefined
        const collapsedAssistantGroupIds = Array.from(
          new Set(
            filteredTopics
              .filter((topic) => !topic.pinned)
              .map(getTopicAssistantDisplayGroupId)
              .filter((groupId) => groupId !== activeAssistantGroupId)
          )
        )
        setTopicExpansionAssistant(collapsedAssistantGroupIds)
      }
      void setTopicDisplayMode(nextMode)
    },
    [activeTopic, filteredTopics, setTopicDisplayMode, setTopicExpansionAssistant]
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
          toast.error(formatErrorMessageWithPrefix(err, t('assistants.reorder.error.failed')))

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
  const canSetPanePosition = isAssistantDisplayMode || isRightPanel

  return (
    <>
      <TopicResourceList<Topic>
        key={isRightPanel ? `topic-resource-panel:${assistantIdFilter ?? 'blank'}` : 'topic-resource-sidebar'}
        className={cn(isRightPanel && 'h-full min-h-0 border-r-0')}
        items={visibleFilteredTopics}
        status={listStatus}
        selectedId={hasActiveCenterSurface ? null : activeTopic?.id}
        groupBy={topicGroupBy}
        sectionBy={topicSectionBy}
        collapsedState={collapsedTopicState}
        revealRequest={revealRequest}
        defaultGroupVisibleCount={defaultGroupVisibleCount}
        groupLoadStep={isRightPanel ? Number.POSITIVE_INFINITY : DEFAULT_TOPIC_GROUP_VISIBLE_COUNT}
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
        groupShowMoreLabel={isRightPanel ? undefined : t('chat.topics.group.show_more')}
        groupCollapseLabel={isRightPanel ? undefined : t('chat.topics.group.collapse')}
        onRenameItem={handleRenameTopic}
        onGroupHeaderSelectItem={handleGroupHeaderSelectTopic}
        onReorder={handleTopicReorder}
        onCollapsedStateChange={handleTopicCollapsedStateChange}>
        <ResourceList.Header className={cn('gap-1', isRightPanel && 'pb-1')}>
          {isRightPanel ? (
            <ResourceList.Search
              aria-label={t('chat.topics.search.title')}
              className={RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS}
              placeholder={t('chat.topics.search.placeholder')}
              wrapperClassName="pt-1"
            />
          ) : showHeaderCreateItem ? (
            <>
              <ResourceList.HeaderItem
                type="button"
                command={isAssistantDisplayMode ? undefined : 'topic.create'}
                aria-label={headerCreateLabel}
                disabled={isAssistantDisplayMode && !onAddAssistant}
                icon={isAssistantDisplayMode ? <Plus /> : <SquarePen />}
                label={headerCreateLabel}
                onClick={handleHeaderCreate}
                actions={
                  <>
                    <TopicListOptionsMenu
                      historyRecordsActive={historyRecordsActive}
                      manageAssistantsActive={manageAssistantsMenuItem?.active}
                      mode={displayMode}
                      onChange={handleTopicDisplayModeChange}
                      onManageAssistants={manageAssistantsMenuItem?.onSelect}
                      onOpenHistoryRecords={onOpenHistoryRecords}
                      sectionId={isAssistantDisplayMode ? TOPIC_ASSISTANT_SECTION_ID : undefined}
                    />
                  </>
                }
              />
            </>
          ) : (
            <TopicListOptionsMenu
              historyRecordsActive={historyRecordsActive}
              manageAssistantsActive={manageAssistantsMenuItem?.active}
              mode={displayMode}
              onChange={handleTopicDisplayModeChange}
              onManageAssistants={manageAssistantsMenuItem?.onSelect}
              onOpenHistoryRecords={onOpenHistoryRecords}
              sectionId={TOPIC_ASSISTANT_SECTION_ID}
            />
          )}
        </ResourceList.Header>

        <TopicListBody
          activeTopic={activeTopic}
          assistantMoveTargets={assistantMoveTargets}
          deletingTopicId={deletingTopicId}
          displayMode={displayMode}
          exportMenuOptions={exportMenuOptions as TopicExportMenuOptions}
          isNewlyRenamed={isNewlyRenamed}
          isRenaming={isRenaming}
          isRightPanel={isRightPanel}
          listRef={listRef}
          notesPath={notesPath}
          onAutoRename={handleAutoRename}
          onClearMessages={handleClearMessages}
          onConfirmDelete={handleConfirmDeleteTopic}
          onDeleteClick={handleDeleteTopicClick}
          onDeleteFromMenu={handleDeleteTopicFromMenu}
          onOpenInNewTab={tabs && !isWindowFrame ? openTopicInNewTab : undefined}
          onOpenInNewWindow={tabs ? openTopicInNewWindow : undefined}
          onMoveToAssistant={handleMoveTopicToAssistant}
          onPinTopic={handlePinTopic}
          onRequestTopicImageAction={handleTopicImageAction}
          onSetPanePosition={canSetPanePosition ? setResolvedPanePosition : undefined}
          onSwitchTopic={setActiveTopic}
          panePosition={canSetPanePosition ? resolvedPanePosition : undefined}
          topicsLength={topics.length}
          variant={isAssistantDisplayMode && !isRightPanel ? 'draggable' : 'plain'}
        />
      </TopicResourceList>

      {editDialogTarget ? (
        <Suspense fallback={null}>
          <ResourceEditDialogHost
            target={editDialogTarget}
            onOpenChange={(open) => {
              if (!open) setEditDialogTarget(null)
            }}
            onSaved={refreshAssistants}
          />
        </Suspense>
      ) : null}
      {imageCaptureTargets.map(({ requestId, target: topic }) => (
        <TopicImageCaptureHost key={requestId} topic={topic} />
      ))}
    </>
  )
}

type TopicListBodyVariant = 'draggable' | 'plain'
type TopicStreamState = {
  isFulfilled: boolean
  isPending: boolean
}

const EMPTY_TOPIC_STREAM_STATE: TopicStreamState = Object.freeze({
  isFulfilled: false,
  isPending: false
})

const getTopicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as const

const getTopicStreamLastSeenCompletionCacheKey = (topicId: string) =>
  `topic.stream.last_seen_completion.${topicId}` as const

const selectTopicStreamState = (
  values: readonly [TopicStatusSnapshotEntry | null | undefined, number | null | undefined]
): TopicStreamState => {
  const [statusEntry, lastSeenCompletion] = values
  const status = statusEntry?.status
  const lastCompletedAt = statusEntry?.lastCompletedAt ?? null
  const streamStatus = {
    isFulfilled: status === 'done' && lastCompletedAt !== lastSeenCompletion,
    isPending: status === 'pending' || status === 'streaming'
  }

  // Normalize the idle case to a module constant; the non-idle object is
  // rebuilt per run and bails out via the default shallowEqual.
  return streamStatus.isPending || streamStatus.isFulfilled ? streamStatus : EMPTY_TOPIC_STREAM_STATE
}

const useTopicListStreamStatus = (topicId: string): TopicStreamState =>
  useSharedCacheSelector(
    [getTopicStreamStatusCacheKey(topicId), getTopicStreamLastSeenCompletionCacheKey(topicId)],
    selectTopicStreamState
  )

interface TopicListBodyProps {
  activeTopic?: Topic
  assistantMoveTargets: readonly TopicMoveAssistantTarget[]
  deletingTopicId: string | null
  displayMode: TopicDisplayMode
  exportMenuOptions: TopicExportMenuOptions
  isNewlyRenamed: (topicId: string) => boolean
  isRenaming: (topicId: string) => boolean
  isRightPanel: boolean
  listRef: RefObject<HTMLDivElement | null>
  notesPath: string
  onAutoRename: (topic: Topic) => Promise<void>
  onClearMessages: (topic: Topic) => void
  onConfirmDelete: (topic: Topic, event?: MouseEvent) => Promise<void>
  onDeleteClick: (topicId: string, event: MouseEvent) => void
  onDeleteFromMenu: (topic: Topic) => Promise<void>
  onMoveToAssistant: (topic: Topic, assistantId: string) => void | Promise<void>
  onOpenInNewTab?: (topic: Topic) => void
  onOpenInNewWindow?: (topic: Topic) => void
  onPinTopic: (topic: Topic) => Promise<void>
  onRequestTopicImageAction: (type: TopicImageActionType, topic: Topic) => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onSwitchTopic: (topic: Topic) => void
  panePosition?: TopicTabPosition
  topicsLength: number
  variant: TopicListBodyVariant
}

type TopicRowSharedProps = Omit<TopicListBodyProps, 'activeTopic' | 'listRef' | 'variant'>

function TopicListBody(props: TopicListBodyProps) {
  const { t } = useTranslation()
  const {
    activeTopic,
    assistantMoveTargets,
    deletingTopicId,
    displayMode,
    exportMenuOptions,
    isNewlyRenamed,
    isRenaming,
    isRightPanel,
    listRef,
    notesPath,
    onAutoRename,
    onClearMessages,
    onConfirmDelete,
    onDeleteClick,
    onDeleteFromMenu,
    onMoveToAssistant,
    onOpenInNewTab,
    onOpenInNewWindow,
    onPinTopic,
    onRequestTopicImageAction,
    onSetPanePosition,
    onSwitchTopic,
    panePosition,
    topicsLength,
    variant
  } = props

  const rowProps = useMemo<TopicRowSharedProps>(
    () => ({
      assistantMoveTargets,
      deletingTopicId,
      displayMode,
      exportMenuOptions,
      isNewlyRenamed,
      isRenaming,
      isRightPanel,
      notesPath,
      onAutoRename,
      onClearMessages,
      onConfirmDelete,
      onDeleteClick,
      onDeleteFromMenu,
      onMoveToAssistant,
      onOpenInNewTab,
      onOpenInNewWindow,
      onPinTopic,
      onRequestTopicImageAction,
      onSetPanePosition,
      onSwitchTopic,
      panePosition,
      topicsLength
    }),
    [
      assistantMoveTargets,
      deletingTopicId,
      displayMode,
      exportMenuOptions,
      isNewlyRenamed,
      isRenaming,
      isRightPanel,
      notesPath,
      onAutoRename,
      onClearMessages,
      onConfirmDelete,
      onDeleteClick,
      onDeleteFromMenu,
      onMoveToAssistant,
      onOpenInNewTab,
      onOpenInNewWindow,
      onPinTopic,
      onRequestTopicImageAction,
      onSetPanePosition,
      onSwitchTopic,
      panePosition,
      topicsLength
    ]
  )

  const activeTopicId = activeTopic?.id
  const renderItem = useCallback(
    (topic: Topic) => <TopicRow key={topic.id} topic={topic} isActive={topic.id === activeTopicId} {...rowProps} />,
    [activeTopicId, rowProps]
  )

  return (
    <ResourceList.Body<Topic>
      listRef={listRef}
      draggable={variant === 'draggable'}
      virtualClassName={cn('pt-0', isRightPanel ? 'pb-8' : 'pb-3')}
      errorFallback={<ResourceList.ErrorState message={t('error.boundary.default.message')} />}
      emptyFallback={
        <div className="mx-auto flex h-full w-full max-w-sm items-center justify-center break-words px-5 py-10 text-center text-muted-foreground text-xs">
          {t('chat.topics.empty.title')}
        </div>
      }
      renderItem={renderItem}
    />
  )
}

interface TopicRowWithStatusProps extends TopicRowSharedProps {
  isActive: boolean
  topic: Topic
}

type TopicRowProps = TopicRowWithStatusProps

const TopicRow = memo(function TopicRow({
  assistantMoveTargets,
  deletingTopicId,
  displayMode,
  exportMenuOptions,
  isActive,
  isNewlyRenamed,
  isRenaming,
  isRightPanel,
  notesPath,
  onAutoRename,
  onClearMessages,
  onConfirmDelete,
  onDeleteClick,
  onDeleteFromMenu,
  onMoveToAssistant,
  onOpenInNewTab,
  onOpenInNewWindow,
  onPinTopic,
  onRequestTopicImageAction,
  onSetPanePosition,
  onSwitchTopic,
  panePosition,
  topic,
  topicsLength
}: TopicRowProps) {
  const { t } = useTranslation()
  const shellState = useOptionalShellState()
  const shellActions = useOptionalShellActions()
  const actions = useResourceListActions()
  const rowState = useResourceListRowState(topic.id)
  const streamStatus = useTopicListStreamStatus(topic.id)
  const topicDisplayName = topic.name.trim() ? topic.name : t('chat.conversation.new')
  const topicName = topicDisplayName.replace('`', '')
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
  const canDeleteTopic = !topic.pinned
  const showDetachedStreamIndicator = isRightPanel && hasTopicStreamIndicator
  const showInlineStreamIndicator = hasTopicStreamIndicator && !showDetachedStreamIndicator
  const showDeleteOrStreamAction = showInlineStreamIndicator || canDeleteTopic
  // Reserve right-padding for the title sized to the resting stream indicator and hover actions.
  const trailingActionCount = (showPinAction ? 1 : 0) + (showDeleteOrStreamAction ? 1 : 0)
  const topicTrailingActionPaddingClassName = cn(
    showDetachedStreamIndicator && 'pr-7',
    trailingActionCount >= 3
      ? 'group-focus-within:pr-16 group-hover:pr-16 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-16'
      : trailingActionCount === 2
        ? 'group-focus-within:pr-12 group-hover:pr-12 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-12'
        : trailingActionCount === 1
          ? 'group-focus-within:pr-7 group-hover:pr-7 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-7'
          : ''
  )
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const startInlineRename = useCallback(() => actions.startRename(topic.id), [actions, topic.id])
  const startMenuRename = useCallback(() => setRenameDialogOpen(true), [])
  const submitRenameDialog = useCallback((name: string) => actions.commitRename(topic.id, name), [actions, topic.id])
  const { getMenuActions, handleMenuAction } = useTopicMenuActions({
    exportMenuOptions,
    isActiveInCurrentTab: isActive,
    isRenaming: isRenaming(topic.id),
    notesPath,
    assistantMoveTargets,
    onAutoRename,
    onClearMessages,
    onCopyImage: (topic) => onRequestTopicImageAction('copy', topic),
    onDelete: onDeleteFromMenu,
    onExportImage: (topic) => onRequestTopicImageAction('export', topic),
    onMoveToAssistant,
    onOpenInNewTab,
    onOpenInNewWindow,
    onPinTopic,
    onSetPanePosition,
    onStartRename: startMenuRename,
    panePosition,
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
        if (shellState?.maximized) shellActions?.minimize()
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
      {showDetachedStreamIndicator && (
        <TopicStreamIndicator detached isFulfilled={isTopicStreamFulfilled} isPending={isTopicStreamPending} />
      )}
      <ResourceList.ItemActions active={showInlineStreamIndicator || isConfirmingDeletion}>
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
        {showInlineStreamIndicator ? (
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
      <ResourceListActionContextMenu item={topic} getActions={getMenuActions} onAction={handleMenuAction}>
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
})

const TopicStreamIndicator = ({
  detached = false,
  isFulfilled,
  isPending
}: {
  detached?: boolean
  isFulfilled: boolean
  isPending: boolean
}) => {
  const dotClassName = cn(
    'size-1.25 rounded-full',
    isPending ? 'animation-pulse bg-(--color-warning)' : 'bg-(--color-success)'
  )

  if (!isPending && !isFulfilled) return null

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center',
        detached &&
          '-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 opacity-100 transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0 group-has-[[data-resource-list-item-actions][data-active=true]]:opacity-0',
        !detached && isFulfilled && 'opacity-100 group-hover:opacity-100'
      )}
      data-testid="topic-stream-indicator">
      <span className={dotClassName} />
    </span>
  )
}
