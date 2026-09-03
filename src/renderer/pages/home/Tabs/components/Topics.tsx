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
import { useOptionalRightPanelActions, useOptionalRightPanelState } from '@renderer/components/chat/panes/Shell'
import {
  buildResourceListGroupDropAnchor,
  CONVERSATION_ROW_STATUS_TITLE_CLASS,
  ConversationRowStatus,
  type ConversationRowStatusValue,
  renderAssistantEntityIcon,
  resolveDefaultCollapsedGroupIds,
  ResourceList,
  type ResourceListGroupHeaderKind,
  type ResourceListGroupSeed,
  type ResourceListItemReorderPayload,
  type ResourceListPresentation,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  TopicListOptionsMenu,
  useResourceListActions,
  useResourceListPinnedState,
  useResourceListRowState
} from '@renderer/components/chat/resourceList/base'
import { ResourceRefreshErrorBanner } from '@renderer/components/chat/resourceList/ResourceRefreshErrorBanner'
import { TopicResourceList } from '@renderer/components/chat/resourceList/TopicResourceList'
import { CommandPopupMenu } from '@renderer/components/command'
import {
  readChatDraftPresence,
  subscribeChatDraftCache
} from '@renderer/components/composer/variants/chat/chatDraftCache'
import EditNameDialog from '@renderer/components/EditNameDialog'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import type { ResourceEditDialogTarget } from '@renderer/components/resourceCatalog/dialogs/edit'
import { useClearTopicMessages } from '@renderer/hooks/chat/useClearTopicMessages'
import { useTopicMenuActions } from '@renderer/hooks/chat/useTopicMenuActions'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs, useOptionalTabsContext } from '@renderer/hooks/tab'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useGroupReorder, useGroups } from '@renderer/hooks/useGroups'
import { useImageCaptureTargets } from '@renderer/hooks/useImageCaptureTargets'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useOptimisticResourceName } from '@renderer/hooks/useOptimisticResourceName'
import { usePins } from '@renderer/hooks/usePins'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import {
  cancelTopicRenaming,
  finishTopicRenaming,
  getTopicMessages,
  startTopicRenaming,
  useTopicMutations
} from '@renderer/hooks/useTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import { withSoleGroupLabelHidden } from '@renderer/utils/chat/resourceListBase'
import {
  applyOptimisticTopicDisplayMove,
  buildAssistantGroupDropAnchor,
  buildTopicDropAnchor,
  createTopicDisplayGroupResolver,
  getAssistantIdFromTopicGroupId,
  getTopicAssistantDisplayGroupId,
  getTopicAssistantGroupId,
  moveAssistantGroupAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups,
  TOPIC_ASSISTANT_SECTION_ID,
  TOPIC_PINNED_GROUP_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
  type TopicDisplayMode
} from '@renderer/utils/chat/topicsHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { findLatestActive, pickNeighbourAfterRemoval } from '@renderer/utils/resourceEntity'
import { cn } from '@renderer/utils/style'
import { classifyTurn, type TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { AssistantIconType, TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import dayjs from 'dayjs'
import { FilePenLine, MoreHorizontal, PinIcon, Plus, Trash2, Unlink, XIcon } from 'lucide-react'
import type { MouseEvent, RefObject } from 'react'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  rejectPendingTopicImageActions,
  requestTopicImageAction,
  type TopicImageActionRequest,
  type TopicImageActionType
} from '../../messages/topicImageActionBus'
import TopicImageCaptureHost from '../../messages/TopicImageCaptureHost'
import type { AddNewTopicPayload } from '../../types'
import {
  type AssistantGroupActionContext,
  executeAssistantGroupAction,
  resolveAssistantGroupActions
} from './assistantGroupActions'
import { EMPTY_TOPIC_LIST_ITEM_RECONCILIATION, reconcileTopicListItems } from './topicListItemSharing'

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
const TOPIC_ASSISTANT_GROUP_SECTION_PREFIX = 'topic:section:assistant-group:'
const TOPIC_ASSISTANT_UNGROUPED_SECTION_ID = `${TOPIC_ASSISTANT_GROUP_SECTION_PREFIX}ungrouped`
const TOPIC_EXPORT_MENU_PREFERENCE_KEYS = {
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
} as const

interface Props {
  activeTopic?: Topic
  assistantTopicsSource: AssistantTopicsSource
  assistantIdFilter?: string | null
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  manageAssistantsActive?: boolean
  onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
  onAddAssistant?: () => void | Promise<void>
  clearActiveTopic: () => void
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onManageAssistants?: () => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  panePosition?: TopicTabPosition
  presentation?: ResourceListPresentation
  revealRequest?: ResourceListRevealRequest
  setActiveTopic: (topic: Topic) => void
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

function getAssistantGroupIdFromTopicSectionId(sectionId: string) {
  if (!sectionId.startsWith(TOPIC_ASSISTANT_GROUP_SECTION_PREFIX)) return null

  const groupId = sectionId.slice(TOPIC_ASSISTANT_GROUP_SECTION_PREFIX.length)
  return groupId && groupId !== 'ungrouped' ? groupId : null
}

function AssistantGroupMoreMenu({
  assistantId,
  assistantIconType,
  deleteAssistantDisabled,
  deleteTopicsDisabled,
  disabled,
  isGroupGrouping,
  pinned,
  sidebarPinned,
  onDeleteAssistant,
  onDeleteAllTopics,
  onEdit,
  onSetAssistantIconType,
  onToggleGrouping,
  onTogglePin,
  onToggleSidebar
}: {
  assistantId: string
  assistantIconType: AssistantIconType
  deleteAssistantDisabled?: boolean
  deleteTopicsDisabled?: boolean
  disabled?: boolean
  isGroupGrouping: boolean
  pinned: boolean
  sidebarPinned: boolean
  onDeleteAssistant: (assistantId: string) => void | Promise<void>
  onDeleteAllTopics: (assistantId: string) => void | Promise<void>
  onEdit: (assistantId: string) => void
  onSetAssistantIconType: (iconType: AssistantIconType) => void | Promise<void>
  onToggleGrouping: () => void | Promise<void>
  onTogglePin: (assistantId: string) => void | Promise<void>
  onToggleSidebar: (assistantId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionContext: AssistantGroupActionContext = {
    assistantId,
    assistantIconType,
    deleteAssistantDisabled,
    deleteTopicsDisabled,
    disabled,
    isGroupGrouping,
    onDeleteAssistant,
    onDeleteAllTopics,
    onEdit,
    onSetAssistantIconType,
    onToggleGrouping,
    onTogglePin,
    onToggleSidebar,
    pinned,
    sidebarPinned,
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
  dataEnabled = true,
  historyRecordsActive,
  manageAssistantsActive = false,
  onActiveAssistantDeleted,
  onAddAssistant,
  clearActiveTopic,
  onNewTopic,
  onOpenHistoryRecords,
  onManageAssistants,
  onSetPanePosition,
  panePosition,
  presentation = 'left-panel',
  revealRequest,
  setActiveTopic
}: Props) {
  const { t } = useTranslation()
  const clearTopicMessages = useClearTopicMessages()
  const isRightPanel = presentation === 'right-panel'
  const tabs = useOptionalTabsContext()
  const conversationNav = useConversationNavigation('assistants')
  const isWindowFrame = useWindowFrame().mode === 'window'
  const [groupNow, setGroupNow] = useState(() => dayjs())

  useEffect(() => {
    const updateGroupNow = () => setGroupNow(dayjs())
    const intervalId = window.setInterval(updateGroupNow, 60_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') updateGroupNow()
    }
    window.addEventListener('focus', updateGroupNow)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', updateGroupNow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const { notesPath } = useNotesSettings()
  const {
    updateTopic: patchTopic,
    deleteTopic: deleteTopicById,
    deleteTopicsByAssistantId,
    moveTopic,
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
  // Keep the legacy preference token (`tags`) while grouping by canonical Group rows.
  const isGroupGrouping = assistantSortType === 'tags'
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
  } = usePins('topic', { enabled: dataEnabled })
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
  } = usePins('assistant', { enabled: dataEnabled })
  const assistantPinnedIdSet = useMemo(() => new Set(assistantPinnedIds), [assistantPinnedIds])
  const isAssistantPinActionDisabled = isAssistantPinsLoading || isAssistantPinsRefreshing || isAssistantPinsMutating
  const {
    assistantFavoriteIds: sidebarAssistantFavoriteIds,
    toggleAssistant: toggleSidebarAssistant,
    removeAssistant: removeSidebarAssistant
  } = useSidebarFavorites()
  const sidebarAssistantFavoriteIdSet = useMemo(
    () => new Set(sidebarAssistantFavoriteIds),
    [sidebarAssistantFavoriteIds]
  )
  const handleToggleAssistantSidebar = useCallback(
    (assistantId: string) => {
      if (sidebarAssistantFavoriteIdSet.has(assistantId)) removeSidebarAssistant(assistantId)
      else toggleSidebarAssistant(assistantId)
    },
    [removeSidebarAssistant, sidebarAssistantFavoriteIdSet, toggleSidebarAssistant]
  )
  const {
    topics: apiTopics,
    orderSignature,
    isLoadingAll,
    isFullyLoaded,
    isRefreshing,
    error,
    refreshError,
    refetch: refetchTopics
  } = assistantTopicsSource
  const {
    assistants,
    isLoading: isAssistantsLoading,
    error: assistantsError,
    refetch: refreshAssistants
  } = useAssistantsApi()
  const {
    groups: assistantGroups,
    isLoading: isAssistantGroupsLoading,
    error: assistantGroupsError
  } = useGroups('assistant', { enabled: dataEnabled && isGroupGrouping })
  const { reorderGroup: reorderAssistantGroup } = useGroupReorder()
  const closeConversationTabs = useCloseConversationTabs()
  const { deleteAssistant } = useAssistantMutations()
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

  const topicItemsReconciliationRef = useRef(EMPTY_TOPIC_LIST_ITEM_RECONCILIATION)
  const apiBackedTopics = useMemo(() => {
    const reconciliation = reconcileTopicListItems(apiTopics, isTopicPinned, topicItemsReconciliationRef.current)
    topicItemsReconciliationRef.current = reconciliation
    return reconciliation.items
  }, [apiTopics, isTopicPinned])
  const { items: topics, rename: renameTopicOptimistically } = useOptimisticResourceName(apiBackedTopics)
  const [optimisticMove, setOptimisticMove] = useState<{
    payload: ResourceListItemReorderPayload
    targetAssistantId: string | null
  } | null>(null)
  const apiTopicOrderSignature = useMemo(
    () => `${orderSignature}#${[...topicPinnedIds].sort().join(',')}`,
    [orderSignature, topicPinnedIds]
  )
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
  // unlinked assistant group is a display fallback for orphaned data,
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
  const assistantGroupById = useMemo(
    () => new Map(assistantGroups.map((group) => [group.id, group] as const)),
    [assistantGroups]
  )
  const groupRankById = useMemo(
    () => new Map(assistantGroups.map((group, index) => [group.id, index] as const)),
    [assistantGroups]
  )
  const assistantsForDisplayOrder = useMemo(() => {
    if (!isGroupGrouping) return orderedAssistants

    return orderedAssistants
      .map((assistant, index) => ({ assistant, index }))
      .sort((a, b) => {
        const aPinned = assistantPinnedIdSet.has(a.assistant.id)
        const bPinned = assistantPinnedIdSet.has(b.assistant.id)
        if (aPinned !== bPinned) return aPinned ? -1 : 1
        if (aPinned) return a.index - b.index

        const aGroupRank = a.assistant.groupId ? groupRankById.get(a.assistant.groupId) : undefined
        const bGroupRank = b.assistant.groupId ? groupRankById.get(b.assistant.groupId) : undefined
        const aRank = aGroupRank === undefined ? 0 : aGroupRank + 1
        const bRank = bGroupRank === undefined ? 0 : bGroupRank + 1
        return aRank - bRank || a.index - b.index
      })
      .map(({ assistant }) => assistant)
  }, [assistantPinnedIdSet, groupRankById, isGroupGrouping, orderedAssistants])
  const assistantRankById = useMemo(
    () => new Map(assistantsForDisplayOrder.map((assistant, index) => [assistant.id, index])),
    [assistantsForDisplayOrder]
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

      void renameTopicOptimistically(topic, trimmedName, async () => {
        await updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
        return true
      }).then(
        () => toast.success(t('common.saved')),
        (err) => {
          logger.error('Failed to rename topic', { err, topicId })
          toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
        }
      )
    },
    [renameTopicOptimistically, topics, t, updateTopic]
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
      const wasActiveAtStart = topic.id === activeTopicIdRef.current
      const assistantTopicsBeforeDelete = topicsRef.current.filter(
        (candidate) => candidate.assistantId === topic.assistantId
      )
      const replacement =
        pickNeighbourAfterRemoval(assistantTopicsBeforeDelete, topic.id) ??
        findLatestActive(topicsRef.current.filter((candidate) => candidate.id !== topic.id))

      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        toast.error(message)
        return
      }

      // A mid-delete switch to another topic must win. An empty ('') mirror only reselects
      // when the deleted topic was active at delete start (#19583 race collapse); deleting
      // with no selection at all stays a no-op.
      const currentActiveTopicId = activeTopicIdRef.current
      if (currentActiveTopicId && currentActiveTopicId !== topic.id) return
      if (!currentActiveTopicId && !wasActiveAtStart) return

      if (replacement) {
        setActiveTopic(replacement)
        return
      }

      clearActiveTopic()
    },
    [clearActiveTopic, removeTopic, setActiveTopic, t]
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

  const handleClearMessages = useCallback((topic: Topic) => clearTopicMessages(topic.id), [clearTopicMessages])

  const handleAutoRename = useCallback(
    async (topic: Topic) => {
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
            logger.error('Failed to save automatically renamed topic', { topicId: topic.id, err })
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

  const topicSectionBy = useMemo(() => {
    if (!isAssistantDisplayMode) return undefined

    return (topic: Topic): ResourceListSection => {
      if (isGroupGrouping) {
        const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
        const group = assistant?.groupId ? assistantGroupById.get(assistant.groupId) : undefined

        return group
          ? { id: `${TOPIC_ASSISTANT_GROUP_SECTION_PREFIX}${group.id}`, label: group.name }
          : { id: TOPIC_ASSISTANT_UNGROUPED_SECTION_ID, label: t('assistants.groups.ungrouped') }
      }

      return { id: TOPIC_ASSISTANT_SECTION_ID, label: t('chat.topics.display.assistant') }
    }
  }, [assistantById, assistantGroupById, isAssistantDisplayMode, isGroupGrouping, t])

  const topicGroupSeeds = useMemo<ResourceListGroupSeed[]>(() => {
    if (!isAssistantDisplayMode) return []

    return assistantsForDisplayOrder.map((assistant) => {
      const assistantGroup = assistant.groupId ? assistantGroupById.get(assistant.groupId) : undefined
      const section = isGroupGrouping
        ? assistantGroup
          ? { id: `${TOPIC_ASSISTANT_GROUP_SECTION_PREFIX}${assistantGroup.id}`, label: assistantGroup.name }
          : { id: TOPIC_ASSISTANT_UNGROUPED_SECTION_ID, label: t('assistants.groups.ungrouped') }
        : { id: TOPIC_ASSISTANT_SECTION_ID, label: t('chat.topics.display.assistant') }

      return {
        id: getTopicAssistantGroupId(assistant.id),
        label: assistant.name,
        section
      }
    })
  }, [assistantGroupById, assistantsForDisplayOrder, isAssistantDisplayMode, isGroupGrouping, t])

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
  // Time mode only: "Earlier" above a list with nothing newer restates the list itself.
  const topicGroupByForDisplay = useMemo(
    () =>
      displayMode === 'time'
        ? withSoleGroupLabelHidden<Topic>(topicGroupBy, filteredTopics, { ignoreGroupIds: [TOPIC_PINNED_GROUP_ID] })
        : topicGroupBy,
    [displayMode, filteredTopics, topicGroupBy]
  )
  const assistantIdsWithTopics = useMemo(() => {
    const assistantIds = new Set<string>()

    for (const topic of apiTopics) {
      if (topic.assistantId) assistantIds.add(topic.assistantId)
    }

    return assistantIds
  }, [apiTopics])
  const headerCreateTopicPayload = useMemo(
    () => (isRightPanel ? { assistantId: assistantIdFilter ?? null } : undefined),
    [assistantIdFilter, isRightPanel]
  )
  const headerCreateLabel = isAssistantDisplayMode ? t('chat.add.assistant.title') : t('chat.conversation.new')
  const handleHeaderCreate = isAssistantDisplayMode
    ? () => void onAddAssistant?.()
    : () => void onNewTopic?.(headerCreateTopicPayload)
  const showHeaderCreateItem = !(isAssistantDisplayMode && resolvedPanePosition === 'right')
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
  const listError =
    error ||
    (isAssistantDisplayMode ? (assistantsError ?? (isGroupGrouping ? assistantGroupsError : undefined)) : undefined)
  const historyLoading = isLoadingAll || !isFullyLoaded
  const metadataLoading =
    isTopicPinsLoading ||
    (isAssistantDisplayMode &&
      (isAssistantsLoading || (isGroupGrouping && isAssistantGroupsLoading) || isAssistantPinsLoading))
  const listLoading = historyLoading || metadataLoading
  const visibleFilteredTopics = useMemo(
    () => (metadataLoading ? [] : filteredTopics),
    [filteredTopics, metadataLoading]
  )
  const listStatus = listError
    ? 'error'
    : listLoading && visibleFilteredTopics.length === 0
      ? 'loading'
      : visibleFilteredTopics.length === 0
        ? 'empty'
        : 'idle'
  const dragReady = isAssistantDisplayMode && isFullyLoaded && !isLoadingAll && !isRefreshing
  const hasActiveCenterSurface = manageAssistantsActive || historyRecordsActive
  const openAssistantEditor = useCallback((assistantId: string) => {
    setEditDialogTarget({ kind: 'assistant', id: assistantId })
  }, [])
  const openTopicInNewTab = useCallback(
    (topic: Topic) => {
      conversationNav.openConversationTab(topic.id, topic.name, { forceNew: true })
    },
    [conversationNav]
  )
  const openTopicInNewWindow = useCallback(
    (topic: Topic) => {
      conversationNav.openConversationWindow(topic.id, topic.name)
    },
    [conversationNav]
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
        const activeTopicId = activeTopicIdRef.current
        const deletedActiveTopicId = latestTargetTopicIds.has(activeTopicId) ? activeTopicId : null
        const replacement = deletedActiveTopicId
          ? findLatestActive(topicsRef.current.filter((topic) => !latestTargetTopicIds.has(topic.id)))
          : undefined

        const result = await deleteTopicsByAssistantId(assistantId)
        await refreshTopics()
        // Reselect while the current selection is dead — empty, or switched mid-delete to
        // another topic of the same deleted set (it strands otherwise, #19583).
        const currentActiveTopicId = activeTopicIdRef.current
        if (deletedActiveTopicId && (!currentActiveTopicId || latestTargetTopicIds.has(currentActiveTopicId))) {
          if (replacement) setActiveTopic(replacement)
          else clearActiveTopic()
        }
        toast.success(t('chat.topics.manage.delete.success', { count: result.deletedCount }))
      } catch (err) {
        logger.error('Failed to delete assistant topics', { assistantId, err })
        toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        deletingAssistantGroupIdRef.current = null
        setDeletingAssistantGroupId(null)
      }
    },
    [clearActiveTopic, deleteTopicsByAssistantId, refreshTopics, setActiveTopic, t]
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
                  !assistantIdsWithTopics.has(assistantGroupId)
                }
                disabled={isAssistantPinActionDisabled}
                isGroupGrouping={isGroupGrouping}
                onDeleteAssistant={handleDeleteAssistant}
                pinned={assistantPinnedIdSet.has(assistantGroupId)}
                onDeleteAllTopics={handleDeleteAssistantTopics}
                onEdit={openAssistantEditor}
                onSetAssistantIconType={setAssistantIconType}
                onToggleGrouping={() => setAssistantSortType(isGroupGrouping ? 'list' : 'tags')}
                onTogglePin={handleToggleAssistantPin}
                onToggleSidebar={handleToggleAssistantSidebar}
                sidebarPinned={sidebarAssistantFavoriteIdSet.has(assistantGroupId)}
              />
            </Tooltip>
          )}
          <Tooltip title={t('chat.conversation.new')} delay={500}>
            <ResourceList.GroupHeaderActionButton
              data-ui="chat.topic-list.action.create"
              type="button"
              aria-label={t('chat.conversation.new')}
              onClick={(event) => {
                event.stopPropagation()
                void onNewTopic?.({ assistantId: assistantGroupId })
              }}>
              <NewConversationIcon className="block" />
            </ResourceList.GroupHeaderActionButton>
          </Tooltip>
        </>
      )
    },
    [
      assistantById,
      assistantIdsWithTopics,
      assistantPinnedIdSet,
      assistantIconType,
      deletingAssistantId,
      deletingAssistantGroupId,
      displayMode,
      handleDeleteAssistant,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      handleToggleAssistantSidebar,
      isAssistantPinActionDisabled,
      isGroupGrouping,
      onNewTopic,
      openAssistantEditor,
      setAssistantIconType,
      setAssistantSortType,
      sidebarAssistantFavoriteIdSet,
      t
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
          deletingAssistantGroupId !== null || deletingAssistantId !== null || !assistantIdsWithTopics.has(assistantId),
        disabled: isAssistantPinActionDisabled,
        isGroupGrouping,
        onDeleteAssistant: handleDeleteAssistant,
        onDeleteAllTopics: handleDeleteAssistantTopics,
        onEdit: openAssistantEditor,
        onSetAssistantIconType: setAssistantIconType,
        onToggleGrouping: () => setAssistantSortType(isGroupGrouping ? 'list' : 'tags'),
        onTogglePin: handleToggleAssistantPin,
        onToggleSidebar: handleToggleAssistantSidebar,
        pinned: assistantPinnedIdSet.has(assistantId),
        sidebarPinned: sidebarAssistantFavoriteIdSet.has(assistantId),
        t
      }
      const actions = resolveAssistantGroupActions(actionContext)

      return actionsToCommandMenuExtraItems(actions, (action) => {
        void executeAssistantGroupAction(action, actionContext)
      })
    },
    [
      assistantById,
      assistantIdsWithTopics,
      assistantIconType,
      assistantPinnedIdSet,
      deletingAssistantId,
      deletingAssistantGroupId,
      displayMode,
      handleDeleteAssistant,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      handleToggleAssistantSidebar,
      isAssistantPinActionDisabled,
      isGroupGrouping,
      openAssistantEditor,
      setAssistantIconType,
      setAssistantSortType,
      sidebarAssistantFavoriteIdSet,
      t
    ]
  )

  const getGroupHeaderIcon = useCallback(
    (group: { id: string; label: string }) => {
      if (!isAssistantDisplayMode || group.id === TOPIC_PINNED_GROUP_ID) return undefined
      if (group.id === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) {
        if (assistantIconType === 'none') return undefined

        return (
          <span className="flex size-6 items-center justify-center rounded-full bg-background-subtle text-muted-foreground">
            <Unlink aria-hidden="true" />
          </span>
        )
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
    [assistantById, assistantIconType, defaultModelId, isAssistantDisplayMode]
  )
  // See Sessions: assistants are entities; pinned, time and unlinked groups only gather rows, so
  // they use the recessed bucket voice while staying on the shared row rhythm.
  const getGroupHeaderKind = useCallback((group: { id: string }): ResourceListGroupHeaderKind => {
    return group.id === TOPIC_UNLINKED_ASSISTANT_GROUP_ID ||
      group.id === TOPIC_PINNED_GROUP_ID ||
      group.id.startsWith('topic:time:')
      ? 'bucket'
      : 'entity'
  }, [])

  const getGroupHeaderTooltip = useCallback(
    (group: { id: string }) =>
      group.id === TOPIC_UNLINKED_ASSISTANT_GROUP_ID ? t('chat.topics.group.unknown_assistant_tip') : undefined,
    [t]
  )
  const isGroupHeaderIconVisible = useCallback(
    (group: { id: string; label: string }) => {
      if (!isAssistantDisplayMode || assistantIconType === 'none' || group.id === TOPIC_PINNED_GROUP_ID) return false
      if (group.id === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) return true

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      return !!assistantId && assistantById.has(assistantId)
    },
    [assistantById, assistantIconType, isAssistantDisplayMode]
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
  const topicAssistantSectionIds = useMemo(
    () =>
      isGroupGrouping
        ? [
            TOPIC_ASSISTANT_UNGROUPED_SECTION_ID,
            ...assistantGroups.map((group) => `${TOPIC_ASSISTANT_GROUP_SECTION_PREFIX}${group.id}`)
          ]
        : [TOPIC_ASSISTANT_SECTION_ID],
    [assistantGroups, isGroupGrouping]
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
    ({ overItem, targetGroupId }: { overItem?: Topic; targetGroupId: string }) =>
      isAssistantDisplayMode &&
      !overItem?.pinned &&
      targetGroupId !== TOPIC_PINNED_GROUP_ID &&
      targetGroupId !== TOPIC_UNLINKED_ASSISTANT_GROUP_ID &&
      resolveAssistantIdForTopicGroup(targetGroupId, assistantById) !== undefined,
    [assistantById, isAssistantDisplayMode]
  )

  const canDragTopicGroup = useCallback(
    (group: { id: string }) => {
      if (!isAssistantDisplayMode) return false

      const assistantGroupId = getAssistantGroupIdFromTopicSectionId(group.id)
      if (assistantGroupId) {
        return isGroupGrouping && assistantGroupById.has(assistantGroupId)
      }

      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      return !!assistantId && assistantById.has(assistantId)
    },
    [assistantById, assistantGroupById, isAssistantDisplayMode, isGroupGrouping]
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

      const activeAssistantGroupId = getAssistantGroupIdFromTopicSectionId(activeGroupId)
      const overAssistantGroupId = getAssistantGroupIdFromTopicSectionId(overGroupId)
      if (activeAssistantGroupId || overAssistantGroupId) {
        return (
          isGroupGrouping &&
          !!activeAssistantGroupId &&
          !!overAssistantGroupId &&
          assistantGroupById.has(activeAssistantGroupId) &&
          assistantGroupById.has(overAssistantGroupId)
        )
      }

      const activeAssistantId = getAssistantIdFromTopicGroupId(activeGroupId)
      const overAssistantId = getAssistantIdFromTopicGroupId(overGroupId)

      if (!activeAssistantId || !overAssistantId) return false

      const activeAssistant = assistantById.get(activeAssistantId)
      const overAssistant = assistantById.get(overAssistantId)
      if (!activeAssistant || !overAssistant) return false

      return !isGroupGrouping || (activeAssistant.groupId ?? null) === (overAssistant.groupId ?? null)
    },
    [assistantById, assistantGroupById, isAssistantDisplayMode, isGroupGrouping]
  )

  const handleTopicReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (!isAssistantDisplayMode) return

      if (payload.type === 'group') {
        const activeGroupId = getAssistantGroupIdFromTopicSectionId(payload.activeGroupId)
        const overGroupId = getAssistantGroupIdFromTopicSectionId(payload.overGroupId)

        if (activeGroupId || overGroupId) {
          if (
            !isGroupGrouping ||
            !activeGroupId ||
            !overGroupId ||
            !assistantGroupById.has(activeGroupId) ||
            !assistantGroupById.has(overGroupId)
          ) {
            return
          }

          try {
            await reorderAssistantGroup(activeGroupId, buildResourceListGroupDropAnchor(payload, overGroupId))
          } catch (err) {
            logger.error('Failed to reorder assistant group section', { activeGroupId, err, overGroupId })
            toast.error(formatErrorMessageWithPrefix(err, t('assistants.reorder.error.failed')))
          }

          return
        }

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
      const overTopic =
        payload.overType === 'item' ? topics.find((candidate) => candidate.id === payload.overId) : undefined
      if (overTopic?.pinned) return

      const targetAssistantId = resolveAssistantIdForTopicGroup(payload.targetGroupId, assistantById)
      if (targetAssistantId === undefined) return

      const normalizedPayload = normalizeTopicDropPayload(payload)
      const anchor = buildTopicDropAnchor(normalizedPayload)
      const currentAssistantId = topic.assistantId ?? null
      setOptimisticMove({ payload: normalizedPayload, targetAssistantId })

      const assistantChanged = targetAssistantId !== currentAssistantId

      try {
        // `moveTopic` owns the atomic write and cache orchestration so the open conversation
        // follows the new assistant and the optimistic overlay settles at the final position.
        await moveTopic(payload.activeId, {
          assistantId: assistantChanged ? targetAssistantId : undefined,
          anchor
        })
      } catch (err) {
        setOptimisticMove(null)
        logger.error('Failed to reorder topic by assistant group', { err, topicId: payload.activeId })
      }
    },
    [
      assistantById,
      assistantGroupById,
      isAssistantDisplayMode,
      isGroupGrouping,
      moveTopic,
      orderedAssistants,
      refreshAssistants,
      reorderAssistantGroup,
      t,
      topics
    ]
  )
  const canSetPanePosition = isAssistantDisplayMode || isRightPanel

  return (
    <>
      <TopicResourceList<Topic>
        key={isRightPanel ? `topic-resource-panel:${assistantIdFilter ?? 'blank'}` : 'topic-resource-left-panel'}
        presentation={presentation}
        items={visibleFilteredTopics}
        status={listStatus}
        selectedId={hasActiveCenterSurface ? null : activeTopic?.id}
        groupBy={topicGroupByForDisplay}
        groupSeeds={topicGroupSeeds}
        sectionBy={topicSectionBy}
        collapsedState={collapsedTopicState}
        revealRequest={revealRequest}
        defaultGroupVisibleCount={defaultGroupVisibleCount}
        groupLoadStep={isRightPanel ? Number.POSITIVE_INFINITY : DEFAULT_TOPIC_GROUP_VISIBLE_COUNT}
        getGroupHeaderAction={getGroupHeaderAction}
        getGroupHeaderContextMenu={getGroupHeaderContextMenu}
        getGroupHeaderIcon={getGroupHeaderIcon}
        getGroupHeaderTooltip={getGroupHeaderTooltip}
        isGroupHeaderIconVisible={isGroupHeaderIconVisible}
        getGroupHeaderKind={getGroupHeaderKind}
        groupHeaderClickBehavior={getGroupHeaderClickBehavior}
        dragCapabilities={{
          groups: dragReady,
          items: dragReady,
          itemSameGroup: dragReady,
          itemCrossGroup: dragReady
        }}
        canDragGroup={canDragTopicGroup}
        canDropGroup={canDropTopicGroup}
        canDragItem={canDragTopicItem}
        canDropItem={canDropTopicItem}
        groupEmptyLabel={t('chat.topics.empty.title')}
        groupShowMoreLabel={isRightPanel ? undefined : t('chat.topics.group.show_more')}
        groupCollapseLabel={isRightPanel ? undefined : t('chat.topics.group.collapse')}
        onRenameItem={handleRenameTopic}
        onGroupHeaderSelectItem={handleGroupHeaderSelectTopic}
        onReorder={handleTopicReorder}
        onCollapsedStateChange={handleTopicCollapsedStateChange}>
        <ResourceList.Header>
          {isRightPanel ? (
            <ResourceList.Search
              aria-label={t('chat.topics.search.title')}
              placeholder={t('chat.topics.search.placeholder')}
            />
          ) : showHeaderCreateItem && isAssistantDisplayMode ? (
            <ResourceList.HeaderItem
              type="button"
              aria-label={headerCreateLabel}
              disabled={!onAddAssistant}
              icon={<Plus />}
              label={headerCreateLabel}
              onClick={handleHeaderCreate}
              actions={
                <TopicListOptionsMenu
                  historyRecordsActive={historyRecordsActive}
                  manageAssistantsActive={manageAssistantsActive}
                  mode={displayMode}
                  onChange={handleTopicDisplayModeChange}
                  onManageAssistants={onManageAssistants}
                  onOpenHistoryRecords={onOpenHistoryRecords}
                  sectionIds={topicAssistantSectionIds}
                />
              }
            />
          ) : showHeaderCreateItem ? (
            <ResourceList.HeaderItem
              data-ui="chat.topic-list.action.create"
              type="button"
              command="topic.create"
              aria-label={headerCreateLabel}
              icon={<NewConversationIcon />}
              label={headerCreateLabel}
              onClick={handleHeaderCreate}
              actions={
                <TopicListOptionsMenu
                  historyRecordsActive={historyRecordsActive}
                  manageAssistantsActive={manageAssistantsActive}
                  mode={displayMode}
                  onChange={handleTopicDisplayModeChange}
                  onManageAssistants={onManageAssistants}
                  onOpenHistoryRecords={onOpenHistoryRecords}
                />
              }
            />
          ) : (
            <TopicListOptionsMenu
              historyRecordsActive={historyRecordsActive}
              manageAssistantsActive={manageAssistantsActive}
              mode={displayMode}
              onChange={handleTopicDisplayModeChange}
              onManageAssistants={onManageAssistants}
              onOpenHistoryRecords={onOpenHistoryRecords}
              sectionIds={isAssistantDisplayMode ? topicAssistantSectionIds : undefined}
            />
          )}
        </ResourceList.Header>

        {refreshError && <ResourceRefreshErrorBanner onRetry={refetchTopics} retrying={isRefreshing} />}

        <TopicListBody
          activeTopic={activeTopic}
          assistantMoveTargets={assistantMoveTargets}
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
        {historyLoading && visibleFilteredTopics.length > 0 && (
          <div className="shrink-0 px-3 py-2 text-center text-[11px] text-foreground-tertiary">
            {t('common.loading')}
          </div>
        )}
      </TopicResourceList>

      {editDialogTarget ? (
        <Suspense fallback={null}>
          <ResourceEditDialogHost
            target={editDialogTarget}
            onOpenChange={(open) => {
              if (!open) setEditDialogTarget(null)
            }}
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
  isAwaitingApproval: boolean
  isErrored: boolean
  isFulfilled: boolean
  isPending: boolean
}

const EMPTY_TOPIC_STREAM_STATE: TopicStreamState = Object.freeze({
  isAwaitingApproval: false,
  isErrored: false,
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
  const flags = classifyTurn(status)
  const streamStatus = {
    isAwaitingApproval: flags.isAwaitingApproval || (statusEntry?.awaitingApprovalAnchors.length ?? 0) > 0,
    isErrored: status === 'error',
    isFulfilled: status === 'done' && lastCompletedAt !== lastSeenCompletion,
    isPending: flags.isStreamLive
  }

  // Normalize the idle case to a module constant; the non-idle object is
  // rebuilt per run and bails out via the default shallowEqual.
  return streamStatus.isAwaitingApproval || streamStatus.isPending || streamStatus.isFulfilled || streamStatus.isErrored
    ? streamStatus
    : EMPTY_TOPIC_STREAM_STATE
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
  const rightPanelState = useOptionalRightPanelState()
  const rightPanelActions = useOptionalRightPanelActions()
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
  const {
    isAwaitingApproval: isTopicAwaitingApproval,
    isErrored: isTopicStreamErrored,
    isFulfilled: isTopicStreamFulfilled,
    isPending: isTopicStreamPending
  } = streamStatus
  // Running (spinner) and errored (red) are ongoing states that stay on the
  // selected row too — only the completion dot (green) is a read-receipt that
  // clears once the row is opened (`!isActive`). Awaiting approval is shown as
  // a badge instead of a spinner because the turn needs user action.
  const conversationRowStatus = isTopicAwaitingApproval
    ? 'approval'
    : isTopicStreamPending
      ? 'pending'
      : isTopicStreamErrored
        ? 'error'
        : !isActive && isTopicStreamFulfilled
          ? 'done'
          : null
  const hasTopicStreamIndicator = conversationRowStatus !== null && conversationRowStatus !== 'approval'
  const showPinAction = !rowState.renaming
  const showLeadingSlot = displayMode !== 'time'
  const isConfirmingDeletion = deletingTopicId === topic.id
  const canDeleteTopic = !topic.pinned
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
        if (rightPanelState?.maximized) rightPanelActions?.minimize()
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
          fade
          title={topicName}
          className={cn(
            nameAnimationClassName,
            // The stream indicator is an absolute overlay (keeps no flex space),
            // so the title needs a standing yield for its dot zone; on hover the
            // overlay fades out, the standing yield closes, and the in-flow action rail expands.
            // The draft indicator needs no yield — it stays in flow and reserves its own space.
            hasTopicStreamIndicator && CONVERSATION_ROW_STATUS_TITLE_CLASS
          )}
          onDoubleClick={(event) => {
            event.stopPropagation()
            startInlineRename()
          }}>
          {topicName}
        </ResourceList.ItemTitle>
      )}
      {!rowState.renaming && (
        <TopicTrailingStatus
          topicId={topic.id}
          draftLabel={t('chat.topics.draft')}
          isActive={isActive}
          status={conversationRowStatus}
        />
      )}
      <ResourceList.ItemActions active={isConfirmingDeletion}>
        {showPinAction && (
          <Tooltip title={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
            <ResourceList.ItemAction
              aria-label={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
              className={cn(topic.pinned && 'text-foreground')}
              onClick={(event) => {
                event.stopPropagation()
                void onPinTopic(topic)
              }}>
              <PinIcon size={14} className={cn('size-3.5!', topic.pinned && 'fill-current')} />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
        {canDeleteTopic && (
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
        )}
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

const TOPIC_DRAFT_INDICATOR_CLASS =
  'pointer-events-none flex size-5 max-w-5 shrink-0 items-center justify-center overflow-hidden opacity-100 transition-[margin,max-width,opacity] duration-150 group-hover:-ml-1.5 group-hover:max-w-0 group-hover:opacity-0 group-has-[[data-resource-list-item-actions]:focus-within]:-ml-1.5 group-has-[[data-resource-list-item-actions][data-active=true]]:-ml-1.5 group-has-[[data-resource-list-item-actions]:focus-within]:max-w-0 group-has-[[data-resource-list-item-actions][data-active=true]]:max-w-0 group-has-[[data-resource-list-item-actions]:focus-within]:opacity-0 group-has-[[data-resource-list-item-actions][data-active=true]]:opacity-0'

const TopicTrailingStatus = ({
  topicId,
  draftLabel,
  isActive,
  status
}: {
  topicId: string
  draftLabel: string
  isActive: boolean
  status: ConversationRowStatusValue | null
}) => {
  if (status) {
    return (
      <ConversationRowStatus
        status={status}
        testId={status === 'approval' ? 'topic-awaiting-approval-badge' : 'topic-stream-indicator'}
      />
    )
  }

  // The active row's draft is the text visible in the composer right below it,
  // so flagging it as unsent tells the user nothing.
  if (isActive) return null

  // The draft subscriber mounts only in the lowest-priority branch. Virtualized
  // rows that are offscreen, or rows showing a higher-priority status, subscribe
  // to no draft key at all.
  return <TopicDraftIndicator topicId={topicId} label={draftLabel} />
}

const TopicDraftIndicator = ({ topicId, label }: { topicId: string; label: string }) => {
  const subscribe = useCallback((listener: () => void) => subscribeChatDraftCache(topicId, listener), [topicId])
  const getSnapshot = useCallback(() => readChatDraftPresence(topicId), [topicId])
  const hasDraft = useSyncExternalStore(subscribe, getSnapshot, () => false)

  if (!hasDraft) return null

  return (
    <span aria-label={label} className={TOPIC_DRAFT_INDICATOR_CLASS} role="img">
      <FilePenLine aria-hidden="true" className="size-3 text-foreground-tertiary" />
    </span>
  )
}
