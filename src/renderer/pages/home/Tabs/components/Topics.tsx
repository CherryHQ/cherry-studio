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
  buildResourceOwnerFallbackIds,
  type ConversationResourceMenuItem,
  renderAssistantEntityIcon,
  RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS,
  ResourceList,
  type ResourceListGroup,
  type ResourceListGroupSeed,
  type ResourceListItemReorderPayload,
  type ResourceListRemoteData,
  type ResourceListRemoteGroupState,
  type ResourceListRemoteRevealFailure,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  TopicListOptionsMenu,
  useResourceListActions,
  useResourceListPinnedItems,
  useResourceListRowState
} from '@renderer/components/chat/resourceList/base'
import { TopicResourceList } from '@renderer/components/chat/resourceList/TopicResourceList'
import { useOwnerResourceActivation } from '@renderer/components/chat/resourceList/useOwnerResourceActivation'
import { CommandPopupMenu } from '@renderer/components/command'
import EditNameDialog from '@renderer/components/EditNameDialog'
import type { ResourceEditDialogTarget } from '@renderer/components/resourceCatalog/dialogs/edit'
import { useTopicMenuActions } from '@renderer/hooks/chat/useTopicMenuActions'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs, useOptionalTabsContext } from '@renderer/hooks/tab'
import { useAnchoredResourceWindow } from '@renderer/hooks/useAnchoredResourceWindow'
import { useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useCursorGroupWindows } from '@renderer/hooks/useCursorGroupWindows'
import { useDebouncedValue } from '@renderer/hooks/useDebouncedValue'
import { useImageCaptureTargets } from '@renderer/hooks/useImageCaptureTargets'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePinMutations, usePins } from '@renderer/hooks/usePins'
import {
  type ResourceRemovalSnapshot,
  useResourceRemovalCoordinator
} from '@renderer/hooks/useResourceRemovalCoordinator'
import {
  finishTopicRenaming,
  getTopicMessages,
  mapApiTopicToRendererTopic,
  startTopicRenaming,
  useTopicMutations,
  useTopics,
  useTopicStats
} from '@renderer/hooks/useTopic'
import { useTopicSessionSortPreference } from '@renderer/hooks/useTopicSessionSortPreference'
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
  TOPIC_ORDINARY_GROUP_ID,
  TOPIC_PINNED_GROUP_ID,
  TOPIC_PINNED_SECTION_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
  type TopicDisplayMode
} from '@renderer/utils/chat/topicsHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { TopicListItem as ApiTopicListItem } from '@shared/data/api/schemas/topics'
import type { AssistantIconType, TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
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
import type { AddNewTopicPayload } from '../../types'
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

const DEFAULT_TOPIC_GROUP_VISIBLE_COUNT = 5
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
const TOPIC_PAGE_SIZE = 50
const TOPIC_SEARCH_DEBOUNCE_MS = 300

type TopicResourceItem = Topic & Pick<ApiTopicListItem, 'pinId'>

function mapApiTopicListItem(topic: ApiTopicListItem): TopicResourceItem {
  return {
    ...mapApiTopicToRendererTopic(topic),
    pinned: topic.pinned,
    pinId: topic.pinId
  }
}

interface Props {
  activeTopic?: Topic
  assistantTopicsSource: AssistantTopicsSource
  assistantIdFilter?: string | null
  historyRecordsActive?: boolean
  onActiveAssistantDeleted?: (
    assistantId: string,
    candidateAssistantIds: readonly string[],
    reason: 'deleted' | 'emptied'
  ) => void | Promise<void>
  onAddAssistant?: () => void | Promise<void>
  onClearActiveTopic?: () => void
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  panePosition?: TopicTabPosition
  presentation?: 'sidebar' | 'right-panel'
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  setActiveTopic: (topic: Topic) => void
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
  onClearActiveTopic,
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
  const { notesPath } = useNotesSettings()
  const {
    updateTopic: patchTopic,
    deleteTopic: deleteTopicById,
    deleteTopicsByAssistantId,
    refreshTopics
  } = useTopicMutations()
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [topicSortBy, setTopicSortBy] = useTopicSessionSortPreference('topic.sort_type')
  const [storedPanePosition, setStoredPanePosition] = usePreference('topic.tab.position')
  const [assistantIconType, setAssistantIconType] = usePreference('assistant.icon_type')
  const [assistantSortType, setAssistantSortType] = usePreference('assistant.tab.sort_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const resolvedPanePosition = panePosition ?? storedPanePosition
  const setResolvedPanePosition =
    panePosition === undefined ? (onSetPanePosition ?? setStoredPanePosition) : onSetPanePosition
  const isTagGrouping = assistantSortType === 'tags'
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
  const defaultGroupVisibleCount = displayMode === 'time' ? Number.POSITIVE_INFINITY : DEFAULT_TOPIC_GROUP_VISIBLE_COUNT
  const isAssistantDisplayMode = displayMode === 'assistant'
  const [remoteQuery, setRemoteQuery] = useState('')
  const debouncedRemoteQuery = useDebouncedValue(remoteQuery, TOPIC_SEARCH_DEBOUNCE_MS)
  const isTopicListEnabled = !isRightPanel || assistantIdFilter !== undefined
  const rightPanelOwnerScope = isRightPanel ? (assistantIdFilter === null ? 'unlinked' : assistantIdFilter) : undefined
  const topicStatsQuery = useMemo(
    () => ({
      ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery } : {}),
      ...(rightPanelOwnerScope ? { assistantId: rightPanelOwnerScope } : {})
    }),
    [debouncedRemoteQuery, rightPanelOwnerScope]
  )
  const pinnedTopicsSource = useTopics({
    assistantId: rightPanelOwnerScope,
    enabled: isTopicListEnabled,
    pageSize: TOPIC_PAGE_SIZE,
    pinned: true,
    q: debouncedRemoteQuery
  })
  const { loadNext: loadNextPinnedTopics, refetch: refetchPinnedTopics, topics: pinnedTopicRows } = pinnedTopicsSource
  const ordinaryTopicsSource = useTopics({
    assistantId: rightPanelOwnerScope,
    enabled: isTopicListEnabled && !isAssistantDisplayMode,
    pageSize: TOPIC_PAGE_SIZE,
    pinned: false,
    q: debouncedRemoteQuery,
    sortBy: topicSortBy
  })
  const {
    hasNext: hasMoreOrdinaryTopics,
    isLoading: isOrdinaryTopicsLoading,
    isRefreshing: isOrdinaryTopicsRefreshing,
    loadNext: loadNextOrdinaryTopics,
    refetch: refetchOrdinaryTopics,
    topics: ordinaryTopicRows
  } = ordinaryTopicsSource
  const {
    stats: topicStats,
    isLoading: isTopicStatsLoading,
    error: topicStatsError
  } = useTopicStats({ enabled: isTopicListEnabled, query: topicStatsQuery })
  const { pin: pinTopic, unpin: unpinTopic, isMutating: isPinsMutating } = usePinMutations('topic')
  const {
    isLoading: isAssistantPinsLoading,
    isMutating: isAssistantPinsMutating,
    isRefreshing: isAssistantPinsRefreshing,
    pinnedIds: assistantPinnedIds,
    togglePin: toggleAssistantPin
  } = usePins('assistant')
  const assistantPinnedIdSet = useMemo(() => new Set(assistantPinnedIds), [assistantPinnedIds])
  const isAssistantPinActionDisabled = isAssistantPinsLoading || isAssistantPinsRefreshing || isAssistantPinsMutating
  const { loadLatestTopic, stats: globalTopicStats } = assistantTopicsSource
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
  const [optimisticallyRemovedTopicIds, setOptimisticallyRemovedTopicIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [optimisticTopicNames, setOptimisticTopicNames] = useState<Record<string, string>>({})
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

  const [optimisticMove, setOptimisticMove] = useState<{
    payload: ResourceListItemReorderPayload
    targetAssistantId: string | null
  } | null>(null)
  const activeTopicRef = useRef(activeTopic)

  useEffect(() => {
    activeTopicRef.current = activeTopic
  }, [activeTopic])

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

  const assistantTopicStatsByGroupId = useMemo(() => {
    const result = new Map<string, { count: number; pinnedCount: number; hasDefaultAssistantTopics: boolean }>()

    for (const entry of topicStats?.byAssistant ?? []) {
      const groupId =
        entry.assistantId && assistantById.has(entry.assistantId)
          ? getTopicAssistantDisplayGroupId({ assistantId: entry.assistantId })
          : TOPIC_UNLINKED_ASSISTANT_GROUP_ID
      const current = result.get(groupId) ?? { count: 0, pinnedCount: 0, hasDefaultAssistantTopics: false }
      current.count += entry.count
      current.pinnedCount += entry.pinnedCount
      current.hasDefaultAssistantTopics ||= entry.assistantId === null
      result.set(groupId, current)
    }

    return result
  }, [assistantById, topicStats])
  const globalTopicCountByAssistantId = useMemo(
    () =>
      new Map(
        (globalTopicStats?.byAssistant ?? []).flatMap((entry) =>
          entry.assistantId ? ([[entry.assistantId, entry.count]] as const) : []
        )
      ),
    [globalTopicStats]
  )
  const topicOwnerFallbackAssistantIds = useMemo(
    () =>
      orderedAssistants
        .filter((assistant) => (globalTopicCountByAssistantId.get(assistant.id) ?? 0) > 0)
        .map((assistant) => assistant.id),
    [globalTopicCountByAssistantId, orderedAssistants]
  )
  const orderedAssistantTopicGroupIds = useMemo(() => {
    const groupIds = orderedAssistants
      .map((assistant) => getTopicAssistantDisplayGroupId({ assistantId: assistant.id }))
      .filter((groupId) => {
        const stats = assistantTopicStatsByGroupId.get(groupId)
        return !!stats && stats.count - stats.pinnedCount > 0
      })
    const unlinkedStats = assistantTopicStatsByGroupId.get(TOPIC_UNLINKED_ASSISTANT_GROUP_ID)
    if (unlinkedStats && unlinkedStats.count - unlinkedStats.pinnedCount > 0) {
      groupIds.push(TOPIC_UNLINKED_ASSISTANT_GROUP_ID)
    }
    return groupIds
  }, [assistantTopicStatsByGroupId, orderedAssistants])
  const activeOrdinaryAssistantGroupId =
    activeTopic && activeTopic.pinned !== true && !pinnedTopicRows.some((topic) => topic.id === activeTopic.id)
      ? getTopicAssistantDisplayGroupId(activeTopic)
      : undefined
  const collapsedAssistantTopicGroupIds =
    topicExpansionAssistant ??
    orderedAssistantTopicGroupIds.filter((groupId) => groupId !== activeOrdinaryAssistantGroupId)
  const initialAssistantTopicGroupIds = useMemo(
    () =>
      isAssistantDisplayMode
        ? orderedAssistantTopicGroupIds.filter((groupId) => !collapsedAssistantTopicGroupIds.includes(groupId))
        : [],
    [collapsedAssistantTopicGroupIds, isAssistantDisplayMode, orderedAssistantTopicGroupIds]
  )
  const fetchAssistantTopicPage = useCallback(
    async (groupId: string, cursor?: string) => {
      const assistantId = getAssistantIdFromTopicGroupId(groupId)
      const ownerScope = groupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID ? 'unlinked' : assistantId
      if (!ownerScope) return { items: [] }

      const page = await dataApiService.get('/topics', {
        query: {
          assistantId: ownerScope,
          cursor,
          limit: TOPIC_PAGE_SIZE,
          pinned: false,
          ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery } : {}),
          sortBy: topicSortBy
        }
      })
      return { ...page, items: page.items.map(mapApiTopicListItem) }
    },
    [debouncedRemoteQuery, topicSortBy]
  )
  const getTopicResourceItemId = useCallback((topic: TopicResourceItem) => topic.id, [])
  const {
    items: assistantWindowTopics,
    loadGroup: loadAssistantTopicGroup,
    loadMoreGroup: loadMoreAssistantTopicGroup,
    refillGroup: refillAssistantTopicGroup,
    windows: assistantTopicWindows
  } = useCursorGroupWindows<TopicResourceItem>({
    continuityKey: JSON.stringify({
      mode: 'assistant',
      ownerScope: rightPanelOwnerScope,
      q: debouncedRemoteQuery
    }),
    enabled: isTopicListEnabled && isAssistantDisplayMode,
    fetchPage: fetchAssistantTopicPage,
    getItemId: getTopicResourceItemId,
    groupIds: orderedAssistantTopicGroupIds,
    initialGroupIds: initialAssistantTopicGroupIds,
    queryKey: JSON.stringify({
      groups: orderedAssistantTopicGroupIds,
      ownerScope: rightPanelOwnerScope,
      q: debouncedRemoteQuery,
      sortBy: topicSortBy
    })
  })
  const fetchAnchoredTopicPage = useCallback(
    async (identity: { band: 'pinned' | 'ordinary'; groupId: string }, cursor: string) => {
      const groupedOwnerScope =
        identity.band === 'ordinary' && isAssistantDisplayMode
          ? identity.groupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID
            ? 'unlinked'
            : getAssistantIdFromTopicGroupId(identity.groupId)
          : undefined
      const page = await dataApiService.get('/topics', {
        query: {
          cursor,
          limit: TOPIC_PAGE_SIZE,
          pinned: identity.band === 'pinned',
          ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery } : {}),
          ...(rightPanelOwnerScope || groupedOwnerScope
            ? { assistantId: rightPanelOwnerScope ?? groupedOwnerScope }
            : {}),
          ...(identity.band === 'ordinary' ? { sortBy: topicSortBy } : {})
        }
      })
      return { ...page, items: page.items.map(mapApiTopicListItem) }
    },
    [debouncedRemoteQuery, isAssistantDisplayMode, rightPanelOwnerScope, topicSortBy]
  )
  const {
    clear: clearAnchoredTopicWindow,
    isLoading: isAnchoredTopicWindowLoading,
    loadMoreGroup: loadMoreAnchoredTopicGroup,
    loadPreviousGroup: loadPreviousAnchoredTopicGroup,
    replace: replaceAnchoredTopicWindow,
    window: anchoredTopicWindow
  } = useAnchoredResourceWindow<TopicResourceItem>({
    fetchPage: fetchAnchoredTopicPage,
    getItemId: getTopicResourceItemId,
    resetKey: JSON.stringify({
      displayMode,
      ownerScope: rightPanelOwnerScope,
      q: debouncedRemoteQuery,
      sortBy: topicSortBy
    })
  })
  const pinnedTopics = useMemo(() => pinnedTopicRows.map(mapApiTopicListItem), [pinnedTopicRows])
  const ordinaryTopics = useMemo(() => ordinaryTopicRows.map(mapApiTopicListItem), [ordinaryTopicRows])
  const commitTopicPin = useCallback(
    async (topic: TopicResourceItem) => {
      if (topic.pinId) {
        await unpinTopic(topic.pinId)
      } else {
        await pinTopic(topic.id)
      }
    },
    [pinTopic, unpinTopic]
  )
  const sourceTopics = useMemo(() => {
    const byId = new Map<string, TopicResourceItem>()
    const ordinarySource = isAssistantDisplayMode ? assistantWindowTopics : ordinaryTopics
    for (const topic of ordinarySource) {
      if (
        anchoredTopicWindow?.band === 'ordinary' &&
        (!isAssistantDisplayMode || getTopicAssistantDisplayGroupId(topic) === anchoredTopicWindow.groupId)
      ) {
        continue
      }
      byId.set(topic.id, topic)
    }
    for (const topic of anchoredTopicWindow?.band === 'pinned' ? [] : pinnedTopics) byId.set(topic.id, topic)
    for (const topic of anchoredTopicWindow?.items ?? []) byId.set(topic.id, topic)
    return [...byId.values()]
  }, [anchoredTopicWindow, assistantWindowTopics, ordinaryTopics, isAssistantDisplayMode, pinnedTopics])
  useEffect(() => {
    if (anchoredTopicWindow && activeTopic?.id !== anchoredTopicWindow.anchorId) clearAnchoredTopicWindow()
  }, [activeTopic?.id, anchoredTopicWindow, clearAnchoredTopicWindow])
  const { items: projectedTopics, togglePinned: togglePinnedTopicItem } = useResourceListPinnedItems({
    disabled: isPinsMutating,
    items: sourceTopics,
    onTogglePin: commitTopicPin,
    resetKey: JSON.stringify({ displayMode, ownerScope: rightPanelOwnerScope, q: debouncedRemoteQuery })
  })
  const topics = useMemo(
    () =>
      projectedTopics
        .filter((topic) => !optimisticallyRemovedTopicIds.has(topic.id))
        .map((topic) =>
          optimisticTopicNames[topic.id] === undefined ? topic : { ...topic, name: optimisticTopicNames[topic.id] }
        ),
    [optimisticTopicNames, optimisticallyRemovedTopicIds, projectedTopics]
  )
  useEffect(() => {
    const sourceIds = new Set(sourceTopics.map((topic) => topic.id))
    setOptimisticallyRemovedTopicIds((current) => {
      const next = new Set([...current].filter((id) => sourceIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [sourceTopics])
  useEffect(() => {
    const sourceNameById = new Map(sourceTopics.map((topic) => [topic.id, topic.name]))
    setOptimisticTopicNames((current) => {
      const next = { ...current }
      let changed = false
      for (const [id, name] of Object.entries(current)) {
        if (sourceNameById.get(id) === name) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [sourceTopics])
  const optimisticallyRemoveTopic = useCallback((topic: Topic) => {
    setOptimisticallyRemovedTopicIds((current) => (current.has(topic.id) ? current : new Set([...current, topic.id])))
  }, [])
  const restoreOptimisticallyRemovedTopic = useCallback((topic: Topic) => {
    setOptimisticallyRemovedTopicIds((current) => {
      if (!current.has(topic.id)) return current
      const next = new Set(current)
      next.delete(topic.id)
      return next
    })
  }, [])
  const topicOrderSignature = useMemo(
    () =>
      topics
        .map((topic) => `${topic.id}:${topic.assistantId ?? ''}:${topic.orderKey ?? ''}:${topic.pinned ? '1' : '0'}`)
        .join('|'),
    [topics]
  )
  const topicsRef = useRef(topics)
  const activeTopicIdRef = useRef(activeTopic?.id ?? '')
  const previousRevealDisplayModeRef = useRef(displayMode)
  const modeRevealRequestIdRef = useRef(0)
  const incomingRevealRequestKey = revealRequest ? `${revealRequest.requestId}:${revealRequest.itemId}` : null
  const [modeRevealRequest, setModeRevealRequest] = useState<{
    incomingRequestKey: string | null
    request?: ResourceListRevealRequest
  }>()
  const effectiveRevealRequest =
    modeRevealRequest?.incomingRequestKey === incomingRevealRequestKey ? modeRevealRequest.request : revealRequest
  const commitActiveTopic = useCallback(
    (topic: Topic) => {
      activeTopicIdRef.current = topic.id
      setActiveTopic(topic)
    },
    [setActiveTopic]
  )
  const activateOwnerTopic = useCallback(
    (topic: ApiTopic) => commitActiveTopic(mapApiTopicToRendererTopic(topic)),
    [commitActiveTopic]
  )
  const loadLatestTopicForOwner = useCallback((assistantId: string) => loadLatestTopic(assistantId), [loadLatestTopic])
  const { activateOwnerResource, cancelOwnerResourceActivation } = useOwnerResourceActivation({
    loadResourceForOwner: loadLatestTopicForOwner,
    onActivateResource: activateOwnerTopic
  })

  useEffect(() => {
    topicsRef.current = topics
  }, [topics])

  useEffect(() => {
    activeTopicIdRef.current = activeTopic?.id ?? ''
    cancelOwnerResourceActivation()
  }, [activeTopic?.id, cancelOwnerResourceActivation])

  const handleSwitchTopic = useCallback(
    (topic: Topic) => {
      cancelOwnerResourceActivation()
      commitActiveTopic(topic)
    },
    [cancelOwnerResourceActivation, commitActiveTopic]
  )

  useEffect(() => {
    if (previousRevealDisplayModeRef.current === displayMode) return
    previousRevealDisplayModeRef.current = displayMode
    const request =
      revealRequest?.itemId === activeTopic?.id
        ? revealRequest
        : activeTopic
          ? { itemId: activeTopic.id, requestId: 0 }
          : undefined
    if (!request) {
      setModeRevealRequest(undefined)
      return
    }

    // A fresh request identity makes ResourceList re-locate the current result,
    // expanding only its saved group while preserving every other collapse choice.
    modeRevealRequestIdRef.current -= 1
    setModeRevealRequest({
      incomingRequestKey: incomingRevealRequestKey,
      request: { ...request, requestId: modeRevealRequestIdRef.current }
    })
  }, [activeTopic, displayMode, incomingRevealRequestKey, revealRequest])

  useEffect(() => {
    setOptimisticMove(null)
  }, [topicOrderSignature])

  const toggleTopicPinned = useCallback(
    async (topicId: string) => {
      const topic = topicsRef.current.find((candidate) => candidate.id === topicId)
      if (topic) await togglePinnedTopicItem(topic)
    },
    [togglePinnedTopicItem]
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

      setOptimisticTopicNames((current) => ({ ...current, [topicId]: trimmedName }))
      void updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true }).then(
        () => toast.success(t('common.saved')),
        (err) => {
          setOptimisticTopicNames((current) => {
            if (current[topicId] !== trimmedName) return current
            const next = { ...current }
            delete next[topicId]
            return next
          })
          logger.error('Failed to rename topic', { err, topicId })
          toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
        }
      )
    },
    [topics, t, updateTopic]
  )

  const isRenaming = useCallback((topicId: string) => renamingTopics.includes(topicId), [renamingTopics])
  const isNewlyRenamed = useCallback((topicId: string) => newlyRenamedTopics.includes(topicId), [newlyRenamedTopics])

  const handlePinTopic = useCallback(
    async (topic: Topic) => {
      if (isPinsMutating) return
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
    [isPinsMutating, toggleTopicPinned]
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
    [t, updateTopic]
  )

  const ordinaryTopicGroupLabel = t('chat.topics.title')
  const topicGroupBy = useMemo(
    () =>
      createTopicDisplayGroupResolver<Topic>({
        assistantById,
        defaultAssistant,
        mode: displayMode,
        labels: {
          pinned: t('selector.common.pinned_title'),
          ordinary: ordinaryTopicGroupLabel,
          assistant: {
            unlinked: t('chat.topics.group.unknown_assistant')
          }
        },
        pinnedAsSection: isAssistantDisplayMode
      }),
    [assistantById, defaultAssistant, displayMode, isAssistantDisplayMode, ordinaryTopicGroupLabel, t]
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

  const topicGroupSeeds = useMemo<ResourceListGroupSeed[]>(() => {
    const seeds: ResourceListGroupSeed[] = []
    const pinnedCount = topicStats?.pinnedCount ?? 0
    if (pinnedCount > 0 || pinnedTopicsSource.error) {
      seeds.push({
        id: TOPIC_PINNED_GROUP_ID,
        label: isAssistantDisplayMode ? '' : t('selector.common.pinned_title'),
        count: pinnedCount,
        section: isAssistantDisplayMode
          ? { id: TOPIC_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
          : undefined
      })
    }

    if (!isAssistantDisplayMode) {
      const ordinaryCount = Math.max(0, (topicStats?.total ?? 0) - pinnedCount)
      if (ordinaryCount > 0 || ordinaryTopicsSource.error) {
        seeds.push({ id: TOPIC_ORDINARY_GROUP_ID, label: ordinaryTopicGroupLabel, count: ordinaryCount })
      }
      return seeds
    }

    for (const groupId of orderedAssistantTopicGroupIds) {
      const stats = assistantTopicStatsByGroupId.get(groupId)
      const count = stats ? stats.count - stats.pinnedCount : 0
      if (count <= 0) continue

      const assistantId = getAssistantIdFromTopicGroupId(groupId)
      const assistant = assistantId ? assistantById.get(assistantId) : undefined
      const groupLabel =
        assistant?.name ||
        (stats?.hasDefaultAssistantTopics ? defaultAssistant.name : t('chat.topics.group.unknown_assistant'))
      let section: ResourceListSection = {
        id: TOPIC_ASSISTANT_SECTION_ID,
        label: t('chat.topics.display.assistant')
      }
      if (isTagGrouping) {
        const tag = assistant?.tags?.[0]?.name?.trim()
        section = tag
          ? { id: `${TOPIC_ASSISTANT_TAG_SECTION_PREFIX}${encodeURIComponent(tag)}`, label: tag }
          : { id: TOPIC_ASSISTANT_UNTAGGED_SECTION_ID, label: t('assistants.tags.untagged') }
      }

      seeds.push({ id: groupId, label: groupLabel, count, section })
    }
    return seeds
  }, [
    assistantById,
    assistantTopicStatsByGroupId,
    defaultAssistant.name,
    isAssistantDisplayMode,
    isTagGrouping,
    ordinaryTopicGroupLabel,
    orderedAssistantTopicGroupIds,
    pinnedTopicsSource.error,
    t,
    topicStats,
    ordinaryTopicsSource.error
  ])
  const loadedTopicCountByGroupId = useMemo(() => {
    const result = new Map<string, number>()
    for (const topic of topics) {
      const groupId = topicGroupBy(topic)?.id
      if (groupId) result.set(groupId, (result.get(groupId) ?? 0) + 1)
    }
    return result
  }, [topicGroupBy, topics])
  const topicGroupStates = useMemo(() => {
    const result: Record<string, ResourceListRemoteGroupState> = {}
    for (const seed of topicGroupSeeds) {
      const loadedCount = loadedTopicCountByGroupId.get(seed.id) ?? 0
      const totalCount = seed.count ?? 0
      const anchored = anchoredTopicWindow?.groupId === seed.id ? anchoredTopicWindow : undefined

      if (seed.id === TOPIC_PINNED_GROUP_ID) {
        result[seed.id] = {
          totalCount,
          hasMore: anchored ? !!anchored.nextCursor : loadedCount < totalCount || !!pinnedTopicsSource.error,
          hasPrevious: !!anchored?.previousCursor,
          status: pinnedTopicsSource.error
            ? 'error'
            : loadedCount === 0 && (pinnedTopicsSource.isLoading || pinnedTopicsSource.isRefreshing)
              ? 'loading'
              : loadedCount === 0
                ? 'empty'
                : 'idle'
        }
        continue
      }

      if (isAssistantDisplayMode) {
        const window = assistantTopicWindows[seed.id]
        result[seed.id] = {
          totalCount,
          hasMore: anchored ? !!anchored.nextCursor : window ? !!window.nextCursor : totalCount > 0,
          hasPrevious: !!anchored?.previousCursor,
          status: window?.status ?? (initialAssistantTopicGroupIds.includes(seed.id) ? 'loading' : 'idle')
        }
        continue
      }

      result[seed.id] = {
        totalCount,
        hasMore: anchored ? !!anchored.nextCursor : hasMoreOrdinaryTopics || !!ordinaryTopicsSource.error,
        hasPrevious: !!anchored?.previousCursor,
        status: ordinaryTopicsSource.error
          ? 'error'
          : loadedCount === 0 && (isOrdinaryTopicsLoading || isOrdinaryTopicsRefreshing)
            ? 'loading'
            : loadedCount === 0
              ? 'empty'
              : 'idle'
      }
    }
    return result
  }, [
    anchoredTopicWindow,
    assistantTopicWindows,
    ordinaryTopicsSource.error,
    hasMoreOrdinaryTopics,
    initialAssistantTopicGroupIds,
    isOrdinaryTopicsLoading,
    isOrdinaryTopicsRefreshing,
    isAssistantDisplayMode,
    loadedTopicCountByGroupId,
    pinnedTopicsSource.error,
    pinnedTopicsSource.isLoading,
    pinnedTopicsSource.isRefreshing,
    topicGroupSeeds
  ])

  const baseGroupedTopics = useMemo(
    () =>
      sortTopicsForDisplayGroups(topics, {
        assistantRankById,
        mode: displayMode,
        sortBy: topicSortBy
      }),
    [assistantRankById, displayMode, topicSortBy, topics]
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
  const getTopicDisplayGroupId = useCallback(
    (topic: Topic) => topicGroupBy(topic)?.id ?? (topic.pinned ? TOPIC_PINNED_GROUP_ID : TOPIC_ORDINARY_GROUP_ID),
    [topicGroupBy]
  )
  const getActiveTopicId = useCallback(() => activeTopicIdRef.current, [])
  const clearTopicSelection = useCallback(() => {
    activeTopicIdRef.current = ''
    onClearActiveTopic?.()
  }, [onClearActiveTopic])
  const refillTopicRemovalGroup = useCallback(
    async (snapshot: ResourceRemovalSnapshot<Topic>) => {
      const currentAnchoredWindow =
        anchoredTopicWindow?.groupId === snapshot.groupId &&
        anchoredTopicWindow.items.some((topic) => topic.id === snapshot.itemId)
          ? anchoredTopicWindow
          : undefined

      if (currentAnchoredWindow) {
        const nextVisible = snapshot.groupItems[snapshot.displayedIndex + 1]
        const previousVisible = snapshot.groupItems[snapshot.displayedIndex - 1]
        const survivingAnchor = nextVisible ?? previousVisible

        if (survivingAnchor) {
          const groupedOwnerScope =
            snapshot.band === 'ordinary' && isAssistantDisplayMode
              ? snapshot.groupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID
                ? 'unlinked'
                : getAssistantIdFromTopicGroupId(snapshot.groupId)
              : undefined
          const result = await dataApiService.get('/topics/window', {
            query: {
              anchorId: survivingAnchor.id,
              limit: TOPIC_PAGE_SIZE,
              sortBy: topicSortBy,
              ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery } : {}),
              ...(rightPanelOwnerScope || groupedOwnerScope
                ? { assistantId: rightPanelOwnerScope ?? groupedOwnerScope }
                : {})
            }
          })
          if (result.status === 'FOUND') {
            const items = result.items.map(mapApiTopicListItem)
            const survivingAnchorIndex = items.findIndex((topic) => topic.id === survivingAnchor.id)
            const selectionIndex = nextVisible
              ? survivingAnchorIndex
              : items[survivingAnchorIndex + 1]
                ? survivingAnchorIndex + 1
                : survivingAnchorIndex
            const selected = items[selectionIndex]
            if (selected) {
              replaceAnchoredTopicWindow({
                anchorId: selected.id,
                band: result.band,
                groupId: snapshot.groupId,
                items,
                previousCursor: result.previousCursor,
                nextCursor: result.nextCursor
              })
            }
            return { items, selectionIndex }
          }
        }
      }

      if (snapshot.band === 'ordinary' && isAssistantDisplayMode) {
        clearAnchoredTopicWindow()
        const items = await refillAssistantTopicGroup(snapshot.groupId, snapshot.loadedWindowSize)
        return { items }
      }

      const groupedOwnerScope =
        snapshot.band === 'ordinary' && isAssistantDisplayMode
          ? snapshot.groupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID
            ? 'unlinked'
            : getAssistantIdFromTopicGroupId(snapshot.groupId)
          : undefined
      const byId = new Map<string, TopicResourceItem>()
      let cursor: string | undefined
      let nextCursor: string | undefined
      do {
        const page = await dataApiService.get('/topics', {
          query: {
            cursor,
            limit: TOPIC_PAGE_SIZE,
            pinned: snapshot.band === 'pinned',
            ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery } : {}),
            ...(rightPanelOwnerScope || groupedOwnerScope
              ? { assistantId: rightPanelOwnerScope ?? groupedOwnerScope }
              : {}),
            ...(snapshot.band === 'ordinary' ? { sortBy: topicSortBy } : {})
          }
        })
        for (const topic of page.items) {
          const mapped = mapApiTopicListItem(topic)
          byId.set(mapped.id, mapped)
        }
        cursor = page.nextCursor
        nextCursor = page.nextCursor
      } while (byId.size < snapshot.loadedWindowSize && cursor)

      const items = [...byId.values()]
      if (snapshot.band === 'pinned') await refetchPinnedTopics()
      else await refetchOrdinaryTopics()

      if (currentAnchoredWindow) {
        const selectionIndex = Math.min(snapshot.displayedIndex, Math.max(items.length - 1, 0))
        const selected = items[selectionIndex]
        if (selected) {
          replaceAnchoredTopicWindow({
            anchorId: selected.id,
            band: snapshot.band,
            groupId: snapshot.groupId,
            items,
            nextCursor
          })
        } else {
          clearAnchoredTopicWindow()
        }
      }
      return { items }
    },
    [
      anchoredTopicWindow,
      clearAnchoredTopicWindow,
      debouncedRemoteQuery,
      isAssistantDisplayMode,
      refillAssistantTopicGroup,
      refetchOrdinaryTopics,
      refetchPinnedTopics,
      replaceAnchoredTopicWindow,
      rightPanelOwnerScope,
      topicSortBy
    ]
  )
  const resolveTopicOwnerFallback = useCallback(
    async (snapshot: ResourceRemovalSnapshot<Topic>) => {
      const deletedTopic = snapshot.item
      const hasLiveOwner = !!deletedTopic.assistantId && assistantById.has(deletedTopic.assistantId)
      const currentOwnerLatest = await loadLatestTopic(hasLiveOwner ? deletedTopic.assistantId : null)
      if (currentOwnerLatest) return undefined

      const eligibleAssistantIds = new Set(topicOwnerFallbackAssistantIds)
      const orderedEligibleAssistantIds = orderedAssistants
        .map((assistant) => assistant.id)
        .filter((assistantId) => eligibleAssistantIds.has(assistantId) || assistantId === deletedTopic.assistantId)
      const fallbackAssistantIds = hasLiveOwner
        ? buildResourceOwnerFallbackIds(orderedEligibleAssistantIds, deletedTopic.assistantId!)
        : orderedEligibleAssistantIds.reverse()

      for (const assistantId of fallbackAssistantIds) {
        const latest = await loadLatestTopic(assistantId)
        if (latest) return mapApiTopicToRendererTopic(latest)
      }
      return null
    },
    [assistantById, loadLatestTopic, orderedAssistants, topicOwnerFallbackAssistantIds]
  )
  const { remove: coordinateTopicRemoval } = useResourceRemovalCoordinator<Topic>({
    getActiveId: getActiveTopicId,
    getBand: (topic) => (topic.pinned ? 'pinned' : 'ordinary'),
    getGroupId: getTopicDisplayGroupId,
    getItemId: (topic) => topic.id,
    refillGroup: refillTopicRemovalGroup,
    resolveOwnerFallback: isAssistantDisplayMode ? resolveTopicOwnerFallback : undefined,
    optimisticallyRemove: optimisticallyRemoveTopic,
    restoreOptimisticRemoval: restoreOptimisticallyRemovedTopic,
    selectItem: handleSwitchTopic,
    clearSelection: clearTopicSelection
  })
  const handleDeleteTopicFromMenu = useCallback(
    async (topic: Topic) => {
      try {
        await coordinateTopicRemoval({
          item: topic,
          displayedItems: filteredTopics,
          groupOrder: topicGroupSeeds.map((group) => group.id),
          context: undefined,
          commit: () => removeTopic(topic)
        })
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        toast.error(message)
      }
    },
    [coordinateTopicRemoval, filteredTopics, removeTopic, t, topicGroupSeeds]
  )
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
  const headerCreateTopicPayload = useMemo(
    () => (isRightPanel ? { assistantId: assistantIdFilter ?? null } : undefined),
    [assistantIdFilter, isRightPanel]
  )
  const headerCreateLabel = isAssistantDisplayMode ? t('chat.add.assistant.title') : t('chat.conversation.new')
  const handleHeaderCreate = isAssistantDisplayMode
    ? () => void onAddAssistant?.()
    : () => void onNewTopic?.(headerCreateTopicPayload)
  const showHeaderCreateItem = !(isAssistantDisplayMode && resolvedPanePosition === 'right')
  const getCreateTopicPayloadForGroup = useCallback(
    (groupId: string): AddNewTopicPayload | undefined => {
      if (groupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) return { assistantId: null }
      const assistantId = getAssistantIdFromTopicGroupId(groupId)
      return assistantId && assistantById.has(assistantId) ? { assistantId } : undefined
    },
    [assistantById]
  )
  const loadTopicGroup = useCallback(
    async (groupId: string) => {
      if (groupId === TOPIC_PINNED_GROUP_ID) return pinnedTopics[0]?.id ?? null
      if (isAssistantDisplayMode) return loadAssistantTopicGroup(groupId)

      return ordinaryTopics[0]?.id ?? null
    },
    [ordinaryTopics, isAssistantDisplayMode, loadAssistantTopicGroup, pinnedTopics]
  )
  const loadMoreTopicGroup = useCallback(
    async (groupId: string) => {
      if (anchoredTopicWindow?.groupId === groupId) {
        await loadMoreAnchoredTopicGroup(groupId)
        return
      }
      if (groupId === TOPIC_PINNED_GROUP_ID) {
        if (pinnedTopicsSource.error) {
          await refetchPinnedTopics()
          return
        }
        loadNextPinnedTopics()
        return
      }
      if (isAssistantDisplayMode) {
        await loadMoreAssistantTopicGroup(groupId)
        return
      }
      if (ordinaryTopicsSource.error) {
        await refetchOrdinaryTopics()
        return
      }
      loadNextOrdinaryTopics()
    },
    [
      anchoredTopicWindow?.groupId,
      ordinaryTopicsSource.error,
      isAssistantDisplayMode,
      loadMoreAnchoredTopicGroup,
      loadMoreAssistantTopicGroup,
      loadNextOrdinaryTopics,
      loadNextPinnedTopics,
      pinnedTopicsSource.error,
      refetchOrdinaryTopics,
      refetchPinnedTopics
    ]
  )
  const revealTopic = useCallback(
    async (request: ResourceListRevealRequest) => {
      const fetchWindow = (q: string | undefined, assistantId?: string) =>
        dataApiService.get('/topics/window', {
          query: {
            anchorId: request.itemId,
            limit: TOPIC_PAGE_SIZE,
            sortBy: topicSortBy,
            ...(q ? { q } : {}),
            ...(assistantId ? { assistantId } : {})
          }
        })

      let resolvedQuery = debouncedRemoteQuery || undefined
      let result = await fetchWindow(resolvedQuery, rightPanelOwnerScope)
      if (result.status === 'ANCHOR_OUTSIDE_QUERY' && resolvedQuery) {
        if (!request.clearQuery) {
          setModeRevealRequest((current) =>
            current?.request?.requestId === request.requestId ? { ...current, request: undefined } : current
          )
          return true
        }
        setRemoteQuery('')
        resolvedQuery = undefined
        result = await fetchWindow(undefined, rightPanelOwnerScope)
      }
      if (result.status !== 'FOUND') return false

      let groupId = result.band === 'pinned' ? TOPIC_PINNED_GROUP_ID : TOPIC_ORDINARY_GROUP_ID
      if (result.band === 'ordinary' && isAssistantDisplayMode) {
        const anchor = result.items[result.anchorIndex]
        groupId = getTopicDisplayGroupId(mapApiTopicListItem(anchor))
        const ownerScope =
          groupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID
            ? 'unlinked'
            : resolveAssistantIdForTopicGroup(groupId, assistantById)
        if (!ownerScope) return false
        result = await fetchWindow(resolvedQuery, ownerScope)
        if (result.status !== 'FOUND') return false
      }

      replaceAnchoredTopicWindow({
        anchorId: request.itemId,
        band: result.band,
        groupId,
        items: result.items.map(mapApiTopicListItem),
        previousCursor: result.previousCursor,
        nextCursor: result.nextCursor
      })
      return true
    },
    [
      assistantById,
      debouncedRemoteQuery,
      getTopicDisplayGroupId,
      isAssistantDisplayMode,
      replaceAnchoredTopicWindow,
      rightPanelOwnerScope,
      topicSortBy
    ]
  )
  const handleTopicRevealError = useCallback(
    (failure: ResourceListRemoteRevealFailure, request: ResourceListRevealRequest) => {
      if (failure.kind === 'not-found') {
        toast.error(t('history.error.topic_not_found'))
        return
      }
      logger.error('Failed to reveal topic', { err: failure.error, topicId: request.itemId })
      toast.error(formatErrorMessageWithPrefix(failure.error, t('common.error')))
    },
    [t]
  )
  const topicListRemoteData = useMemo<ResourceListRemoteData>(
    () => ({
      groupStates: topicGroupStates,
      loadGroup: loadTopicGroup,
      loadMoreGroup: loadMoreTopicGroup,
      loadPreviousGroup: loadPreviousAnchoredTopicGroup,
      onRevealError: handleTopicRevealError,
      onQueryChange: setRemoteQuery,
      query: remoteQuery,
      revealItem: revealTopic
    }),
    [
      handleTopicRevealError,
      loadMoreTopicGroup,
      loadPreviousAnchoredTopicGroup,
      loadTopicGroup,
      remoteQuery,
      revealTopic,
      topicGroupStates
    ]
  )
  // Stream failures are recoverable at their remote group footer. Keeping them out of the
  // top-level status is what leaves that error group mounted even before any rows have loaded.
  const listError = topicStatsError || (isAssistantDisplayMode ? assistantsError : undefined)
  const listLoading =
    topics.length === 0 &&
    (isTopicStatsLoading ||
      pinnedTopicsSource.isLoading ||
      (!isAssistantDisplayMode ? isOrdinaryTopicsLoading : isAssistantsLoading))
  const visibleFilteredTopics = filteredTopics
  const listStatus =
    listError && topics.length === 0
      ? 'error'
      : listLoading
        ? 'loading'
        : topicGroupSeeds.length === 0 && (topicStats?.total ?? topics.length) === 0
          ? 'empty'
          : 'idle'
  const handleTopicEndReached = useCallback(() => {
    if (
      !isAssistantDisplayMode &&
      !ordinaryTopicsSource.error &&
      hasMoreOrdinaryTopics &&
      !isOrdinaryTopicsRefreshing
    ) {
      loadNextOrdinaryTopics()
    }
  }, [
    ordinaryTopicsSource.error,
    hasMoreOrdinaryTopics,
    isAssistantDisplayMode,
    isOrdinaryTopicsRefreshing,
    loadNextOrdinaryTopics
  ])
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const hasActiveCenterSurface = hasActiveResourceMenuItem || historyRecordsActive
  const getTopicGroupHeaderClickBehavior = useCallback(
    (group: ResourceListGroup) =>
      isAssistantDisplayMode && resolveAssistantIdForTopicGroup(group.id, assistantById)
        ? 'select-first-then-toggle'
        : 'toggle',
    [assistantById, isAssistantDisplayMode]
  )
  const getTopicGroupHeaderSelected = useCallback(
    (group: ResourceListGroup) => {
      if (hasActiveCenterSurface) return false
      const assistantId = resolveAssistantIdForTopicGroup(group.id, assistantById)
      return !!assistantId && activeTopic?.assistantId === assistantId
    },
    [activeTopic?.assistantId, assistantById, hasActiveCenterSurface]
  )
  const handleActivateAssistantGroup = useCallback(
    async (group: ResourceListGroup) => {
      const assistantId = resolveAssistantIdForTopicGroup(group.id, assistantById)
      if (!assistantId) return false

      try {
        await activateOwnerResource(assistantId)
      } catch (err) {
        logger.error('Failed to activate assistant topic group', { assistantId, err })
        toast.error(t('common.error'))
      }

      return true
    },
    [activateOwnerResource, assistantById, t]
  )
  const manageAssistantsMenuItem = resourceMenuItems?.find((item) => item.id === 'assistant-resource-view')
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
      if ((globalTopicCountByAssistantId.get(assistantId) ?? 0) === 0) return

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

        const fallbackAssistantIds = buildResourceOwnerFallbackIds(topicOwnerFallbackAssistantIds, assistantId)
        const result = await deleteTopicsByAssistantId(assistantId)
        if (activeTopic?.assistantId === assistantId) {
          if (onActiveAssistantDeleted) {
            await onActiveAssistantDeleted(assistantId, fallbackAssistantIds, 'emptied')
          } else {
            onClearActiveTopic?.()
          }
        }
        await refreshTopics()
        toast.success(t('chat.topics.manage.delete.success', { count: result.deletedCount }))
      } catch (err) {
        logger.error('Failed to delete assistant topics', { assistantId, err })
        toast.error(t('chat.topics.manage.delete.error'))
      } finally {
        deletingAssistantGroupIdRef.current = null
        setDeletingAssistantGroupId(null)
      }
    },
    [
      activeTopic?.assistantId,
      deleteTopicsByAssistantId,
      globalTopicCountByAssistantId,
      onActiveAssistantDeleted,
      onClearActiveTopic,
      refreshTopics,
      t,
      topicOwnerFallbackAssistantIds
    ]
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

        const fallbackAssistantIds = buildResourceOwnerFallbackIds(topicOwnerFallbackAssistantIds, assistantId)
        const result = await deleteAssistant(assistantId, { deleteTopics: true })
        closeConversationTabs('assistants', result.deletedTopicIds ?? [])
        if (activeTopic?.assistantId === assistantId) {
          await onActiveAssistantDeleted?.(assistantId, fallbackAssistantIds, 'deleted')
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
      t,
      topicOwnerFallbackAssistantIds
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
                  (globalTopicCountByAssistantId.get(assistantGroupId) ?? 0) === 0
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
      globalTopicCountByAssistantId,
      handleDeleteAssistant,
      handleDeleteAssistantTopics,
      handleToggleAssistantPin,
      isAssistantPinActionDisabled,
      isTagGrouping,
      onNewTopic,
      openAssistantEditor,
      setAssistantIconType,
      setAssistantSortType,
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
          deletingAssistantGroupId !== null ||
          deletingAssistantId !== null ||
          (globalTopicCountByAssistantId.get(assistantId) ?? 0) === 0,
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
      globalTopicCountByAssistantId,
      isAssistantPinActionDisabled,
      isTagGrouping,
      openAssistantEditor,
      setAssistantIconType,
      setAssistantSortType,
      t
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
      isAssistantDisplayMode
        ? (topicExpansionAssistant ??
          topicGroupSeeds
            .filter((group) => group.label && group.id !== activeOrdinaryAssistantGroupId)
            .map((group) => group.id))
        : undefined,
    [activeOrdinaryAssistantGroupId, isAssistantDisplayMode, topicExpansionAssistant, topicGroupSeeds]
  )
  const handleTopicCollapsedStateChange = useCallback(
    (nextCollapsedIds: string[]) => {
      if (isAssistantDisplayMode) setTopicExpansionAssistant(nextCollapsedIds)
    },
    [isAssistantDisplayMode, setTopicExpansionAssistant]
  )
  const handleTopicDisplayModeChange = useCallback(
    (nextMode: TopicDisplayMode) => {
      if (nextMode === 'assistant' && topicExpansionAssistant == null) {
        const collapsedAssistantGroupIds = orderedAssistantTopicGroupIds.filter(
          (groupId) => groupId !== activeOrdinaryAssistantGroupId
        )
        setTopicExpansionAssistant(collapsedAssistantGroupIds)
      }
      void setTopicDisplayMode(nextMode)
    },
    [
      activeOrdinaryAssistantGroupId,
      orderedAssistantTopicGroupIds,
      setTopicDisplayMode,
      setTopicExpansionAssistant,
      topicExpansionAssistant
    ]
  )
  const topicItemDragReady =
    !isRightPanel &&
    topicSortBy === 'orderKey' &&
    (isAssistantDisplayMode || (!isOrdinaryTopicsLoading && !isOrdinaryTopicsRefreshing))
  const isTopicItemGroupStable = useCallback(
    (groupId: string) =>
      topicGroupStates[groupId]?.status === 'idle' &&
      !(anchoredTopicWindow?.groupId === groupId && isAnchoredTopicWindowLoading),
    [anchoredTopicWindow?.groupId, isAnchoredTopicWindowLoading, topicGroupStates]
  )
  const canDragTopicItem = useCallback(
    ({ item, group }: { item: Topic; group: ResourceListGroup }) =>
      topicItemDragReady && !item.pinned && isTopicItemGroupStable(group.id),
    [isTopicItemGroupStable, topicItemDragReady]
  )

  const canDropTopicItem = useCallback(
    ({
      overItem,
      overType,
      sourceGroupId,
      targetGroupId
    }: {
      overItem?: Topic
      overType: 'group' | 'item'
      sourceGroupId: string
      targetGroupId: string
    }) => {
      if (
        !topicItemDragReady ||
        overType !== 'item' ||
        !overItem ||
        targetGroupId === TOPIC_PINNED_GROUP_ID ||
        !isTopicItemGroupStable(sourceGroupId) ||
        !isTopicItemGroupStable(targetGroupId)
      ) {
        return false
      }
      if (!isAssistantDisplayMode) {
        return sourceGroupId === TOPIC_ORDINARY_GROUP_ID && targetGroupId === TOPIC_ORDINARY_GROUP_ID
      }
      if (targetGroupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) return sourceGroupId === targetGroupId
      return resolveAssistantIdForTopicGroup(targetGroupId, assistantById) !== undefined
    },
    [assistantById, isAssistantDisplayMode, isTopicItemGroupStable, topicItemDragReady]
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
      if (payload.type === 'group') {
        if (!isAssistantDisplayMode) return
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

      if (
        !topicItemDragReady ||
        !isTopicItemGroupStable(payload.sourceGroupId) ||
        !isTopicItemGroupStable(payload.targetGroupId)
      ) {
        return
      }

      if (payload.sourceGroupId === TOPIC_PINNED_GROUP_ID || payload.targetGroupId === TOPIC_PINNED_GROUP_ID) return

      const topic = topics.find((candidate) => candidate.id === payload.activeId)
      if (!topic || topic.pinned) return

      let targetAssistantId = topic.assistantId ?? null
      if (isAssistantDisplayMode) {
        if (payload.targetGroupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID) {
          if (payload.sourceGroupId !== payload.targetGroupId) return
        } else {
          const resolvedTargetAssistantId = resolveAssistantIdForTopicGroup(payload.targetGroupId, assistantById)
          if (resolvedTargetAssistantId === undefined) return
          targetAssistantId = resolvedTargetAssistantId
        }
      } else if (
        payload.sourceGroupId !== TOPIC_ORDINARY_GROUP_ID ||
        payload.targetGroupId !== TOPIC_ORDINARY_GROUP_ID
      ) {
        return
      }

      const normalizedPayload = normalizeTopicDropPayload(payload)
      const anchor = buildTopicDropAnchor(normalizedPayload)
      const ownerChanged = (topic.assistantId ?? null) !== targetAssistantId
      if (!anchor) return
      if (ownerChanged && targetAssistantId === null) return
      setOptimisticMove({ payload: normalizedPayload, targetAssistantId })

      try {
        if (ownerChanged) {
          await dataApiService.post(`/topics/${payload.activeId}/move`, {
            body: { assistantId: targetAssistantId, order: anchor }
          })
        } else {
          await dataApiService.patch(`/topics/${payload.activeId}/order`, { body: anchor })
        }
        if (ownerChanged && activeTopicRef.current?.id === topic.id) {
          setActiveTopic({ ...activeTopicRef.current, assistantId: targetAssistantId ?? undefined })
        }
        await refreshTopics()
      } catch (err) {
        setOptimisticMove(null)
        logger.error('Failed to reorder topic by assistant group', { err, topicId: payload.activeId })
        toast.error(formatErrorMessageWithPrefix(err, t('chat.topics.reorder.error.failed')))
      }
    },
    [
      assistantById,
      isAssistantDisplayMode,
      isTopicItemGroupStable,
      orderedAssistants,
      refreshAssistants,
      refreshTopics,
      setActiveTopic,
      t,
      topicItemDragReady,
      topics
    ]
  )
  const canSetPanePosition = isAssistantDisplayMode || isRightPanel

  return (
    <>
      <TopicResourceList<TopicResourceItem>
        key={isRightPanel ? `topic-resource-panel:${assistantIdFilter ?? 'blank'}` : 'topic-resource-sidebar'}
        className={cn(isRightPanel && 'h-full min-h-0 border-r-0')}
        items={visibleFilteredTopics}
        status={listStatus}
        groupSeeds={topicGroupSeeds}
        remoteData={topicListRemoteData}
        selectedId={hasActiveCenterSurface ? null : activeTopic?.id}
        groupBy={topicGroupBy}
        sectionBy={topicSectionBy}
        collapsedState={collapsedTopicState}
        revealRequest={effectiveRevealRequest}
        defaultGroupVisibleCount={defaultGroupVisibleCount}
        groupLoadStep={displayMode === 'time' ? Number.POSITIVE_INFINITY : DEFAULT_TOPIC_GROUP_VISIBLE_COUNT}
        getGroupHeaderAction={getGroupHeaderAction}
        getGroupHeaderContextMenu={getGroupHeaderContextMenu}
        getGroupHeaderIcon={getGroupHeaderIcon}
        groupHeaderClickBehavior={getTopicGroupHeaderClickBehavior}
        getGroupHeaderSelected={getTopicGroupHeaderSelected}
        onGroupHeaderActivate={handleActivateAssistantGroup}
        dragCapabilities={{
          groups: isAssistantDisplayMode,
          items: topicItemDragReady,
          itemSameGroup: topicItemDragReady,
          itemCrossGroup: isAssistantDisplayMode && topicItemDragReady
        }}
        canDragGroup={canDragTopicGroup}
        canDropGroup={canDropTopicGroup}
        canDragItem={canDragTopicItem}
        canDropItem={canDropTopicItem}
        groupShowMoreLabel={t('chat.topics.group.show_more')}
        groupCollapseLabel={isRightPanel ? undefined : t('chat.topics.group.collapse')}
        onRenameItem={handleRenameTopic}
        onReorder={handleTopicReorder}
        onCollapsedStateChange={isAssistantDisplayMode ? handleTopicCollapsedStateChange : undefined}>
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
                      onSortByChange={(nextSortBy) => void setTopicSortBy(nextSortBy)}
                      sectionId={isAssistantDisplayMode ? TOPIC_ASSISTANT_SECTION_ID : undefined}
                      sortBy={topicSortBy}
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
              onSortByChange={(nextSortBy) => void setTopicSortBy(nextSortBy)}
              sectionId={TOPIC_ASSISTANT_SECTION_ID}
              sortBy={topicSortBy}
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
          onEndReached={isAssistantDisplayMode ? undefined : handleTopicEndReached}
          onMoveToAssistant={handleMoveTopicToAssistant}
          onOpenInNewTab={tabs && !isWindowFrame ? openTopicInNewTab : undefined}
          onOpenInNewWindow={tabs ? openTopicInNewWindow : undefined}
          onPinTopic={handlePinTopic}
          onRequestTopicImageAction={handleTopicImageAction}
          onSetPanePosition={canSetPanePosition ? setResolvedPanePosition : undefined}
          onSwitchTopic={handleSwitchTopic}
          panePosition={canSetPanePosition ? resolvedPanePosition : undefined}
          topicsLength={topicStats?.total ?? topics.length}
          variant={!isRightPanel && (isAssistantDisplayMode || topicSortBy === 'orderKey') ? 'draggable' : 'plain'}
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
  onEndReached?: () => void
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

type TopicRowSharedProps = Omit<TopicListBodyProps, 'activeTopic' | 'listRef' | 'onEndReached' | 'variant'>

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
    onEndReached,
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
      onEndReached={onEndReached}
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
