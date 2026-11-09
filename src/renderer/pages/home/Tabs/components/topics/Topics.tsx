import { Plus, Unlink } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { TopicMoveAssistantTarget } from '@renderer/components/chat/actions/topicContextMenuActions'
import {
  deleteConversationOwnerPopup,
  permanentDeletePopup
} from '@renderer/components/chat/DeleteConversationOwnerConfirmDialog'
import {
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
  useResourceListPinnedState
} from '@renderer/components/chat/resourceList/base'
import { ResourceRefreshErrorBanner } from '@renderer/components/chat/resourceList/ResourceRefreshErrorBanner'
import { SessionHoverPreviewGroup } from '@renderer/components/chat/resourceList/SessionHoverPreview'
import { TopicResourceList } from '@renderer/components/chat/resourceList/TopicResourceList'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import type { ResourceEditDialogTarget } from '@renderer/components/resourceCatalog/dialogs/edit'
import { useClearTopicMessages } from '@renderer/hooks/chat/useClearTopicMessages'
import { useConversationExportMenuOptions } from '@renderer/hooks/chat/useConversationExportMenuOptions'
import { useResolvedCommand } from '@renderer/hooks/command'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs, useOptionalTabsContext } from '@renderer/hooks/tab'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useCurrentDayStart } from '@renderer/hooks/useCurrentDayStart'
import { useGroupReorder, useGroups } from '@renderer/hooks/useGroups'
import { useImageCaptureTargets } from '@renderer/hooks/useImageCaptureTargets'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useOptimisticResourceName } from '@renderer/hooks/useOptimisticResourceName'
import { usePins } from '@renderer/hooks/usePins'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import {
  cancelTopicRenaming,
  finishTopicRenaming,
  getTopicMessages,
  startTopicRenaming,
  useTopicMutations
} from '@renderer/hooks/useTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { useWindowScopedPersistCache } from '@renderer/hooks/useWindowScopedPersistCache'
import { showImageActionFeedback } from '@renderer/services/imageActionFeedback'
import {
  restoreRecycleBinItem,
  restoreRecycleBinItems,
  restoreRecycleBinUndoGroup,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import { buildResourceListGroupDropAnchor, withSoleGroupLabelHidden } from '@renderer/utils/chat/resourceListBase'
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
import { applyOptimisticOrder, findLatestActive, pickNeighbourAfterRemoval } from '@renderer/utils/resourceEntity'
import {
  createSidebarShortcutTarget,
  getSidebarShortcutResourceIds,
  SIDEBAR_SHORTCUT_PROVIDER_IDS
} from '@renderer/utils/sidebar'
import { classifyTurn } from '@shared/ai/transport'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { isTrashTargetNotFoundError, isTrashTopicBusyError } from '@shared/ipc/errors/trash'

import {
  rejectPendingTopicImageActions,
  requestTopicImageAction,
  type TopicImageActionType
} from '../../../messages/topicImageActionBus'
import TopicImageCaptureHost from '../../../messages/TopicImageCaptureHost'
import type { AddNewTopicPayload } from '../../../types'
import {
  type AssistantGroupActionContext,
  executeAssistantGroupAction,
  resolveAssistantGroupActions
} from './assistantGroupActions'
import { AssistantGroupMoreMenu } from './AssistantGroupMoreMenu'
import { TopicListBody } from './TopicListBody'
import { EMPTY_TOPIC_LIST_ITEM_RECONCILIATION, reconcileTopicListItems } from './topicListItemSharing'

const logger = loggerService.withContext('Topics')

function isTopicPermanentDeleteBusy(topicId: string): boolean {
  const entry = cacheService.getShared(`topic.stream.statuses.${topicId}` as const)
  const flags = classifyTurn(entry?.status)
  return flags.isStreamLive || flags.isAwaitingApproval || (entry?.awaitingApprovalAnchors.length ?? 0) > 0
}

function permanentDeleteFailureMessage(err: unknown, translate: (key: string) => string): string {
  if (isTrashTargetNotFoundError(err)) return translate('recycle_bin.delete.stale')
  if (isTrashTopicBusyError(err)) return translate('recycle_bin.delete.busy')
  if (err instanceof Error && err.message) return err.message
  return translate('chat.topics.manage.delete.error')
}
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
  onLocalPermanentDeletePendingChange?: (id: string | null) => void
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
  onLocalPermanentDeletePendingChange,
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
  const groupNow = useCurrentDayStart()

  const { notesPath } = useNotesSettings()
  const {
    updateTopic: patchTopic,
    deleteTopic: deleteTopicById,
    deleteTopicsByAssistantId,
    moveTopic,
    refreshTopics,
    restoreTopic
  } = useTopicMutations()
  const permanentDeleteShortcut = useResolvedCommand('resource.delete_permanently').shortcutLabel
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
  const [topicExpansionTime, setTopicExpansionTime] = useWindowScopedPersistCache(
    'ui.topic.expansion.time',
    'ui.window.chat.topic.expansion.time'
  )
  const [topicExpansionAssistant, setTopicExpansionAssistant] = useWindowScopedPersistCache(
    'ui.topic.expansion.assistant',
    'ui.window.chat.topic.expansion.assistant'
  )
  const { queueTarget: queueImageCaptureTarget, targets: imageCaptureTargets } = useImageCaptureTargets<Topic>({
    cancelMessage: 'Topic image export was cancelled',
    delayMs: IMAGE_CAPTURE_START_DELAY_MS,
    rejectPendingActions: rejectPendingTopicImageActions
  })
  const exportMenuOptions = useConversationExportMenuOptions()
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
    assistants,
    isLoading: isAssistantsLoading,
    error: assistantsError,
    refetch: refreshAssistants
  } = useAssistantsApi()
  const { shortcuts: sidebarShortcuts, setPinned: setSidebarShortcutPinned } = useSidebarShortcuts()
  const sidebarAssistantFavoriteIdSet = useMemo(
    () => getSidebarShortcutResourceIds(sidebarShortcuts, SIDEBAR_SHORTCUT_PROVIDER_IDS.ASSISTANT),
    [sidebarShortcuts]
  )
  const sidebarTopicFavoriteIdSet = useMemo(
    () => getSidebarShortcutResourceIds(sidebarShortcuts, SIDEBAR_SHORTCUT_PROVIDER_IDS.TOPIC),
    [sidebarShortcuts]
  )
  const handleToggleAssistantSidebar = useCallback(
    (assistantId: string) => {
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.ASSISTANT, assistantId)
      setSidebarShortcutPinned(
        target,
        !sidebarAssistantFavoriteIdSet.has(assistantId),
        assistants.find((assistant) => assistant.id === assistantId)?.name
      )
    },
    [assistants, setSidebarShortcutPinned, sidebarAssistantFavoriteIdSet]
  )
  const handleToggleTopicSidebar = useCallback(
    (topic: Topic) => {
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.TOPIC, topic.id)
      setSidebarShortcutPinned(
        target,
        !sidebarTopicFavoriteIdSet.has(topic.id),
        topic.name.trim() || t('chat.conversation.new')
      )
    },
    [setSidebarShortcutPinned, sidebarTopicFavoriteIdSet, t]
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
    groups: assistantGroups,
    isLoading: isAssistantGroupsLoading,
    error: assistantGroupsError
  } = useGroups('assistant', { enabled: dataEnabled && isGroupGrouping })
  const { reorderGroup: reorderAssistantGroup } = useGroupReorder()
  const closeConversationTabs = useCloseConversationTabs()
  const { deleteAssistant, restoreAssistant } = useAssistantMutations()
  const listRef = useRef<HTMLDivElement>(null)
  const [deletingAssistantGroupId, setDeletingAssistantGroupId] = useState<string | null>(null)
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null)
  const deletingAssistantGroupIdRef = useRef<string | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const handleTopicImageAction = useCallback(
    (type: TopicImageActionType, topic: Topic) => {
      const request = requestTopicImageAction(type, topic, { emit: false })
      showImageActionFeedback(type, request, 'topic-image-export', t)
      queueImageCaptureTarget(request, topic)
    },
    [queueImageCaptureTarget, t]
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
  const permanentDeleteLockRef = useRef(false)
  const assistantPermanentDeleteLockRef = useRef(false)

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

  const orderedAssistants = useMemo(
    () => (optimisticAssistantOrderIds ? applyOptimisticOrder(assistants, optimisticAssistantOrderIds) : assistants),
    [assistants, optimisticAssistantOrderIds]
  )
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
  const assistantByIdRef = useRef(assistantById)

  useEffect(() => {
    assistantByIdRef.current = assistantById
  }, [assistantById])
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
        await deleteTopicById(topic.id)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        if (isTrashTargetNotFoundError(err)) toast.info(t('recycle_bin.already_moved'))
        else if (isTrashTopicBusyError(err)) toast.info(t('recycle_bin.move.blocked_generation'))
        else toast.error(err instanceof Error ? err.message : t('chat.topics.manage.delete.error'))
        return
      }

      // A mid-delete switch to another topic must win. An empty ('') mirror only reselects
      // when the deleted topic was active at delete start (#19583 race collapse); deleting
      // with no selection at all stays a no-op.
      const currentActiveTopicId = activeTopicIdRef.current
      const shouldReplaceSelection = (!currentActiveTopicId && wasActiveAtStart) || currentActiveTopicId === topic.id
      if (shouldReplaceSelection) {
        if (replacement) setActiveTopic(replacement)
        else clearActiveTopic()
      }

      showRecycleBinUndo({
        itemName: topic.name.trim() || t('chat.conversation.new'),
        title: t('common.archived', { name: topic.name.trim() || t('chat.conversation.new') }),
        onUndo: () =>
          restoreRecycleBinItem({
            id: topic.id,
            restore: restoreTopic,
            getActive: (id) => dataApiService.get(`/topics/${id}`),
            refresh: refreshTopics
          })
      })
    },
    [clearActiveTopic, deleteTopicById, refreshTopics, restoreTopic, setActiveTopic, t]
  )

  const handlePermanentDeleteTopic = useCallback(
    async (topic: Topic) => {
      if (permanentDeleteLockRef.current) return
      permanentDeleteLockRef.current = true
      try {
        await permanentDeletePopup.show({
          kind: 'conversation',
          target: 'topic',
          name: topic.name.trim() || t('chat.conversation.new'),
          action: async () => {
            const liveTopic = topicsRef.current.find((candidate) => candidate.id === topic.id)
            if (liveTopic?.pinned) {
              throw new Error(t('recycle_bin.delete.pinned'))
            }
            if (isTopicPermanentDeleteBusy(topic.id)) {
              throw new Error(t('recycle_bin.delete.busy'))
            }

            const wasActiveAtStart = topic.id === activeTopicIdRef.current
            const assistantTopicsBeforeDelete = topicsRef.current.filter(
              (candidate) => candidate.assistantId === (liveTopic?.assistantId ?? topic.assistantId)
            )
            const replacement =
              pickNeighbourAfterRemoval(assistantTopicsBeforeDelete, topic.id) ??
              findLatestActive(topicsRef.current.filter((candidate) => candidate.id !== topic.id))

            onLocalPermanentDeletePendingChange?.(topic.id)
            try {
              let outcome
              try {
                outcome = await deleteTopicById(topic.id, { permanent: true, targetState: 'active' })
              } catch (err) {
                logger.error('Failed to permanently delete topic', { topicId: topic.id, err })
                throw new Error(permanentDeleteFailureMessage(err, t))
              }

              if (!outcome.deletedIds.includes(topic.id)) {
                toast.info(t('recycle_bin.delete.stale'))
                return
              }

              const currentActiveTopicId = activeTopicIdRef.current
              const shouldReplaceSelection =
                (!currentActiveTopicId && wasActiveAtStart) || currentActiveTopicId === topic.id
              if (shouldReplaceSelection) {
                if (replacement) setActiveTopic(replacement)
                else clearActiveTopic()
              }
            } finally {
              onLocalPermanentDeletePendingChange?.(null)
            }
          }
        })
      } finally {
        permanentDeleteLockRef.current = false
      }
    },
    [clearActiveTopic, deleteTopicById, onLocalPermanentDeletePendingChange, setActiveTopic, t]
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
        manualOrder: isRightPanel,
        mode: displayMode,
        now: groupNow
      }),
    [assistantRankById, displayMode, groupNow, isRightPanel, topics]
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
  const dragReady = (isAssistantDisplayMode || isRightPanel) && isFullyLoaded && !isLoadingAll && !isRefreshing
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
        if (result.deletedIds.length === 0) {
          await refreshTopics().catch((err) => {
            logger.warn('Failed to refresh after stale Assistant Topic deletion', { assistantId, err })
          })
          toast.info(t('recycle_bin.already_moved'))
          return
        }

        const deletedIds = [...result.deletedIds]
        showRecycleBinBatchUndo({
          itemCount: deletedIds.length,
          onUndo: () =>
            restoreRecycleBinItems({
              ids: deletedIds,
              restore: restoreTopic,
              getActive: (id) => dataApiService.get(`/topics/${id}`),
              refresh: refreshTopics
            })
        })

        try {
          await refreshTopics()
        } catch (err) {
          logger.warn('Failed to refresh after Assistant Topic deletion', { assistantId, err })
        }
        // Reselect while the current selection is dead — empty, or switched mid-delete to
        // another topic of the same deleted set (it strands otherwise, #19583).
        const currentActiveTopicId = activeTopicIdRef.current
        if (deletedActiveTopicId && (!currentActiveTopicId || latestTargetTopicIds.has(currentActiveTopicId))) {
          if (replacement) setActiveTopic(replacement)
          else clearActiveTopic()
        }
      } catch (err) {
        logger.error('Failed to delete assistant topics', { assistantId, err })
        if (isTrashTopicBusyError(err)) toast.info(t('recycle_bin.move.blocked_generation'))
        else if (isTrashTargetNotFoundError(err)) toast.info(t('recycle_bin.already_moved'))
        else toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        deletingAssistantGroupIdRef.current = null
        setDeletingAssistantGroupId(null)
      }
    },
    [clearActiveTopic, deleteTopicsByAssistantId, refreshTopics, restoreTopic, setActiveTopic, t]
  )

  const refreshAssistantResources = useCallback(async () => {
    const outcomes = await Promise.allSettled([refreshAssistants(), refreshTopics()])
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('Failed to refresh Assistant resources from topic group', { err: outcome.reason })
      }
    }
  }, [refreshAssistants, refreshTopics])

  const handleDeleteAssistant = useCallback(
    async (assistantId: string, mode: 'archive' | 'permanent' = 'archive') => {
      if (mode === 'permanent') {
        if (assistantPermanentDeleteLockRef.current) return
        assistantPermanentDeleteLockRef.current = true
      }

      try {
        if (deletingAssistantId) return

        const assistantName = assistantById.get(assistantId)?.name ?? t('common.unnamed')
        const performDelete = async (deleteTopics: boolean) => {
          if (mode === 'permanent') {
            const liveAssistant = assistantByIdRef.current.get(assistantId)
            const childTopics = topicsRef.current.filter((topic) => topic.assistantId === assistantId)
            if (!liveAssistant) {
              await refreshAssistantResources()
              throw new Error(t('recycle_bin.delete.stale'))
            }
            if (childTopics.some((topic) => isTopicPermanentDeleteBusy(topic.id))) {
              throw new Error(t('recycle_bin.delete.busy'))
            }
          }

          const activeTopicIdAtStart = activeTopicIdRef.current
          setDeletingAssistantId(assistantId)
          try {
            let result
            try {
              result = await deleteAssistant(
                assistantId,
                mode === 'permanent' ? { deleteTopics, permanent: true } : { deleteTopics }
              )
            } catch (err) {
              if (mode === 'permanent') {
                await refreshAssistantResources()
                throw new Error(permanentDeleteFailureMessage(err, t))
              }
              if (!isTrashTargetNotFoundError(err)) throw err
              await refreshAssistantResources()
              toast.info(t('recycle_bin.already_moved'))
              return
            }
            if (!result.deleted) {
              await refreshAssistantResources()
              if (mode === 'permanent') throw new Error(t('recycle_bin.delete.stale'))
              toast.info(t('recycle_bin.already_moved'))
              return
            }

            const deletedTopicIds = result.deletedTopicIds ?? []
            if (mode === 'archive') {
              showRecycleBinUndo({
                itemName: assistantName,
                onUndo: () =>
                  restoreRecycleBinUndoGroup({
                    primary: {
                      id: assistantId,
                      restore: restoreAssistant,
                      getActive: (id) => dataApiService.get(`/assistants/${id}`)
                    },
                    related: {
                      ids: deletedTopicIds,
                      restore: restoreTopic,
                      getActive: (id) => dataApiService.get(`/topics/${id}`)
                    },
                    refresh: refreshAssistantResources
                  })
              })
            }
            const latestActiveTopicId = activeTopicIdRef.current
            if (deletedTopicIds.length > 0) closeConversationTabs('assistants', deletedTopicIds)
            const stillOnDeletedChild =
              (latestActiveTopicId !== '' && deletedTopicIds.includes(latestActiveTopicId)) ||
              (latestActiveTopicId === '' &&
                activeTopicIdAtStart !== '' &&
                deletedTopicIds.includes(activeTopicIdAtStart))
            if (stillOnDeletedChild) {
              try {
                await onActiveAssistantDeleted?.(assistantId)
              } catch (err) {
                logger.warn('Failed to reconcile active Assistant after deletion from topic group', {
                  assistantId,
                  err
                })
              }
            }

            await refreshAssistantResources()
          } catch (err) {
            if (mode === 'permanent') throw err
            logger.error('Failed to delete assistant from topic group', { assistantId, err })
            if (isTrashTopicBusyError(err)) {
              toast.info(t('recycle_bin.move.blocked_generation'))
              return
            }
            throw err
          } finally {
            setDeletingAssistantId(null)
          }
        }

        if (mode === 'permanent') {
          await permanentDeletePopup.show({
            kind: 'owner',
            type: 'assistant',
            name: assistantName,
            action: (deleteChildren) => performDelete(deleteChildren)
          })
          return
        }

        await deleteConversationOwnerPopup.show({
          type: 'assistant',
          action: performDelete
        })
      } finally {
        if (mode === 'permanent') assistantPermanentDeleteLockRef.current = false
      }
    },
    [
      assistantById,
      closeConversationTabs,
      deleteAssistant,
      deletingAssistantId,
      onActiveAssistantDeleted,
      refreshAssistantResources,
      restoreAssistant,
      restoreTopic,
      t
    ]
  )

  const handlePermanentDeleteAssistant = useCallback(
    (assistantId: string) => handleDeleteAssistant(assistantId, 'permanent'),
    [handleDeleteAssistant]
  )

  const deleteAssistantGroupPermanently = useCallback(
    (group: { id: string }) => {
      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      if (!assistantId || !assistantById.has(assistantId)) return
      return handlePermanentDeleteAssistant(assistantId)
    },
    [assistantById, handlePermanentDeleteAssistant]
  )

  const isAssistantGroupPermanentDeleteEligible = useCallback(
    (group: { id: string }) => {
      if (assistantPermanentDeleteLockRef.current || deletingAssistantId !== null) return false
      const assistantId = getAssistantIdFromTopicGroupId(group.id)
      return Boolean(assistantId && assistantById.has(assistantId))
    },
    [assistantById, deletingAssistantId]
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
                onPermanentDeleteAssistant={handlePermanentDeleteAssistant}
                permanentDeleteShortcut={permanentDeleteShortcut}
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
      handlePermanentDeleteAssistant,
      permanentDeleteShortcut,
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
        onPermanentDeleteAssistant: handlePermanentDeleteAssistant,
        permanentDeleteShortcut,
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
      handlePermanentDeleteAssistant,
      permanentDeleteShortcut,
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
          <span className="text-muted-foreground flex size-6 items-center justify-center rounded-full bg-background-subtle">
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
    ({ item }: { item: Topic }) => (isAssistantDisplayMode || isRightPanel) && !item.pinned,
    [isAssistantDisplayMode, isRightPanel]
  )

  const canDropTopicItem = useCallback(
    ({
      overItem,
      sourceGroupId,
      targetGroupId
    }: {
      overItem?: Topic
      sourceGroupId: string
      targetGroupId: string
    }) => {
      if (overItem?.pinned || targetGroupId === TOPIC_PINNED_GROUP_ID) return false
      // The right panel only reorders inside one time group; groups themselves are derived from activity.
      if (isRightPanel) return sourceGroupId === targetGroupId
      return (
        isAssistantDisplayMode &&
        targetGroupId !== TOPIC_UNLINKED_ASSISTANT_GROUP_ID &&
        resolveAssistantIdForTopicGroup(targetGroupId, assistantById) !== undefined
      )
    },
    [assistantById, isAssistantDisplayMode, isRightPanel]
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
      if (!isAssistantDisplayMode && !(isRightPanel && payload.type === 'item')) return

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

      const targetAssistantId = isRightPanel
        ? (topic.assistantId ?? null)
        : resolveAssistantIdForTopicGroup(payload.targetGroupId, assistantById)
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
      isRightPanel,
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
        active={dataEnabled}
        key={isRightPanel ? `topic-resource-panel:${assistantIdFilter ?? 'blank'}` : 'topic-resource-left-panel'}
        permanentDelete={{
          isItemEligible: (item) => !item.pinned && !isTopicPermanentDeleteBusy(item.id),
          onDelete: handlePermanentDeleteTopic
        }}
        onGroupHeaderDeletePermanently={deleteAssistantGroupPermanently}
        isGroupHeaderPermanentDeleteEligible={isAssistantGroupPermanentDeleteEligible}
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
        groupLoadStep={Number.POSITIVE_INFINITY}
        getGroupHeaderAction={getGroupHeaderAction}
        getGroupHeaderContextMenu={getGroupHeaderContextMenu}
        getGroupHeaderIcon={getGroupHeaderIcon}
        getGroupHeaderTooltip={getGroupHeaderTooltip}
        isGroupHeaderIconVisible={isGroupHeaderIconVisible}
        getGroupHeaderKind={getGroupHeaderKind}
        groupHeaderClickBehavior={getGroupHeaderClickBehavior}
        dragCapabilities={{
          groups: dragReady && isAssistantDisplayMode,
          items: dragReady,
          itemSameGroup: dragReady,
          itemCrossGroup: dragReady && isAssistantDisplayMode
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
        <SessionHoverPreviewGroup enabled={dataEnabled}>
          <TopicListBody
            activeTopic={activeTopic}
            assistantMoveTargets={assistantMoveTargets}
            displayMode={displayMode}
            exportMenuOptions={exportMenuOptions}
            listRef={listRef}
            notesPath={notesPath}
            onAutoRename={handleAutoRename}
            onClearMessages={handleClearMessages}
            onDeleteFromMenu={handleDeleteTopicFromMenu}
            onDeletePermanently={handlePermanentDeleteTopic}
            permanentDeleteShortcut={permanentDeleteShortcut}
            onOpenInNewTab={tabs && !isWindowFrame ? openTopicInNewTab : undefined}
            onOpenInNewWindow={tabs ? openTopicInNewWindow : undefined}
            onMoveToAssistant={handleMoveTopicToAssistant}
            onPinTopic={handlePinTopic}
            onToggleSidebar={handleToggleTopicSidebar}
            onRequestTopicImageAction={handleTopicImageAction}
            onSetPanePosition={canSetPanePosition ? setResolvedPanePosition : undefined}
            onSwitchTopic={setActiveTopic}
            panePosition={canSetPanePosition ? resolvedPanePosition : undefined}
            sidebarTopicFavoriteIdSet={sidebarTopicFavoriteIdSet}
            topicsLength={topics.length}
            variant={isAssistantDisplayMode || isRightPanel ? 'draggable' : 'plain'}
          />
        </SessionHoverPreviewGroup>

        {historyLoading && visibleFilteredTopics.length > 0 && (
          <div className="text-foreground-tertiary shrink-0 px-3 py-2 text-center text-[11px]">
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
