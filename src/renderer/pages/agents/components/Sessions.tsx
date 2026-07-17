import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import {
  buildResourceOwnerFallbackIds,
  type ConversationResourceMenuItem,
  remapResourceListCollapsedGroupIds,
  renderAgentEntityIcon,
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
  SESSION_DISPLAY_LABEL_KEYS,
  SessionListOptionsMenu,
  useResourceListPinnedItems
} from '@renderer/components/chat/resourceList/base'
import { SessionResourceList } from '@renderer/components/chat/resourceList/SessionResourceList'
import { useOwnerResourceActivation } from '@renderer/components/chat/resourceList/useOwnerResourceActivation'
import { CommandPopupMenu } from '@renderer/components/command'
import EditNameDialog from '@renderer/components/EditNameDialog'
import ObsidianExportPopup from '@renderer/components/ObsidianExportPopup'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import SaveToKnowledgePopup from '@renderer/components/SaveToKnowledgePopup'
import { dataApiService } from '@renderer/data/DataApiService'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useMultiplePreferences, usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents, useDeleteAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionStats, useSessions, useUpdateSession } from '@renderer/hooks/agent/useSession'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useAnchoredResourceWindow } from '@renderer/hooks/useAnchoredResourceWindow'
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
import { finishTopicRenaming, startTopicRenaming } from '@renderer/hooks/useTopic'
import { useTopicSessionSortPreference } from '@renderer/hooks/useTopicSessionSortPreference'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import {
  type AgentSessionExportOptions,
  agentSessionToMarkdown,
  copyAgentSessionAsMarkdown,
  copyAgentSessionAsPlainText,
  exportAgentSessionAsMarkdown,
  getAgentSessionExportTitle,
  getAgentSessionMessagesForExport
} from '@renderer/services/agentSessionExport'
import {
  exportContentToNotes,
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessagesToNotion
} from '@renderer/services/ExportService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getAgentModelFallbackSnapshot } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import {
  type AgentSessionDisplayMode,
  applyOptimisticSessionDisplayMove,
  buildSessionAgentGroupDropAnchor,
  buildSessionDropAnchor,
  buildSessionWorkdirGroupDropAnchor,
  canDropSessionItemInDisplayGroup,
  createSessionDisplayGroupResolver,
  createSessionWorkdirDisplayMaps,
  getAgentIdFromSessionGroupId,
  getSessionAgentGroupId,
  getSessionWorkdirGroupId,
  getWorkdirPathFromSessionGroupId,
  getWorkspaceIdFromSessionGroupId,
  getWorkspaceSessionGroupId,
  isSystemWorkspaceSession,
  moveSessionAgentGroupAfterDrop,
  moveSessionWorkdirGroupAfterDrop,
  normalizeSessionDropPayload,
  SESSION_AGENT_SECTION_ID,
  SESSION_NO_WORKDIR_GROUP_ID,
  SESSION_ORDINARY_GROUP_ID,
  SESSION_PINNED_GROUP_ID,
  SESSION_PINNED_SECTION_ID,
  SESSION_SYSTEM_WORKSPACE_GROUP_ID,
  SESSION_SYSTEM_WORKSPACE_SECTION_ID,
  SESSION_UNLINKED_AGENT_GROUP_ID,
  SESSION_WORKDIR_SECTION_ID,
  type SessionListItem,
  sortSessionsForDisplayGroups
} from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity, AgentSessionListItem } from '@shared/data/api/schemas/agentSessions'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentSessionWorkspaceSource,
  type AgentWorkspaceEntity
} from '@shared/data/api/schemas/agentWorkspaces'
import type {
  AgentSessionWorkdirSection,
  AssistantIconType,
  TopicTabPosition
} from '@shared/data/preference/preferenceTypes'
import { Folder, FolderOpen, MoreHorizontal, Plus, SquarePen } from 'lucide-react'
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentSessionImageActionRequest,
  type AgentSessionImageActionType,
  rejectPendingAgentSessionImageActions,
  requestAgentSessionImageAction
} from '../messages/agentSessionImageActionBus'
import AgentSessionImageCaptureHost from '../messages/AgentSessionImageCaptureHost'
import type { CreateAgentSessionDefaults } from '../types'
import { type AgentGroupActionContext, executeAgentGroupAction, resolveAgentGroupActions } from './agentGroupActions'
import SessionItem, { type SessionItemMenuActions } from './SessionItem'
import {
  executeWorkdirGroupAction,
  resolveWorkdirGroupActions,
  type WorkdirGroupActionContext
} from './workdirGroupActions'

type SessionsBaseProps = {
  activeSession?: AgentSessionEntity | null
  agentSessionsSource: AgentSessionsSource
  agentIdFilter?: string | null
  historyRecordsActive?: boolean
  onActiveAgentDeleted?: (agentId: string, candidateAgentIds: readonly string[]) => void | Promise<void>
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onCreateSession?: (
    defaults: CreateAgentSessionDefaults
  ) => AgentSessionEntity | null | void | Promise<AgentSessionEntity | null | void>
  onShowMissingAgentSelection?: () => void | Promise<void>
  panePosition?: TopicTabPosition
  presentation?: 'sidebar' | 'right-panel'
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
}

type ControlledSessionsProps = SessionsBaseProps & {
  activeSessionId: string | null
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

type SessionsProps = ControlledSessionsProps

const logger = loggerService.withContext('AgentSessions')

const EMPTY_WORKSPACE_ROWS: AgentWorkspaceEntity[] = []
// Let the context menu close before mounting the heavier offscreen message list.
const IMAGE_CAPTURE_START_DELAY_MS = 160
const DEFAULT_SESSION_GROUP_VISIBLE_COUNT = 5
const SESSION_PAGE_SIZE = 50
const SESSION_SEARCH_DEBOUNCE_MS = 300
const DEFAULT_WORKDIR_SECTION_ORDER: readonly AgentSessionWorkdirSection[] = ['workdir', 'no-workdir']

function normalizeWorkdirSectionOrder(
  order: readonly AgentSessionWorkdirSection[] | undefined
): AgentSessionWorkdirSection[] {
  const source = order ?? DEFAULT_WORKDIR_SECTION_ORDER
  const valid = new Set(DEFAULT_WORKDIR_SECTION_ORDER)
  const normalized = source.filter(
    (section, index): section is AgentSessionWorkdirSection => valid.has(section) && source.indexOf(section) === index
  )
  return [...normalized, ...DEFAULT_WORKDIR_SECTION_ORDER.filter((section) => !normalized.includes(section))]
}

function getWorkdirSectionFromId(sectionId: string): AgentSessionWorkdirSection | undefined {
  if (sectionId === SESSION_WORKDIR_SECTION_ID) return 'workdir'
  if (sectionId === SESSION_SYSTEM_WORKSPACE_SECTION_ID) return 'no-workdir'
  return undefined
}

type SessionCreationDefaults = {
  agentId: string
  workspace?: AgentSessionWorkspaceSource
  workspacePath?: string
}

function AgentGroupMoreMenu({
  agentId,
  assistantIconType,
  deleteAgentDisabled,
  pinDisabled,
  pinned,
  onDeleteAgent,
  onEdit,
  onSetAgentIconType,
  onTogglePin
}: {
  agentId: string
  assistantIconType: AssistantIconType
  deleteAgentDisabled?: boolean
  pinDisabled?: boolean
  pinned: boolean
  onDeleteAgent: (agentId: string) => void | Promise<void>
  onEdit: (agentId: string) => void
  onSetAgentIconType: (iconType: AssistantIconType) => void | Promise<void>
  onTogglePin: (agentId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionContext: AgentGroupActionContext = {
    agentId,
    assistantIconType,
    deleteAgentDisabled,
    onDeleteAgent,
    onEdit,
    onSetAgentIconType,
    onTogglePin,
    pinDisabled,
    pinned,
    t
  }
  const actions = resolveAgentGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeAgentGroupAction(action, actionContext)
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

function WorkdirGroupMoreMenu({
  canDelete,
  canRename,
  deleteDisabled,
  group,
  onDelete,
  onOpen,
  onRename,
  renameDisabled,
  workdirPath
}: {
  canDelete: boolean
  canRename: boolean
  deleteDisabled?: boolean
  group: ResourceListGroup
  onDelete: (group: ResourceListGroup) => void | Promise<void>
  onOpen: (workdirPath: string) => void | Promise<void>
  onRename: (group: ResourceListGroup) => void | Promise<void>
  renameDisabled?: boolean
  workdirPath: string
}) {
  const { t } = useTranslation()
  const actionContext: WorkdirGroupActionContext = {
    canDelete,
    canRename,
    deleteDisabled,
    group,
    onDelete,
    onOpen,
    onRename,
    renameDisabled,
    t,
    workdirPath
  }
  const actions = resolveWorkdirGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeWorkdirGroupAction(action, actionContext)
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

export function buildSessionCreationDefaults(
  session: Pick<AgentSessionEntity, 'agentId' | 'workspaceId' | 'workspace'> | null | undefined
): SessionCreationDefaults | null {
  if (!session?.agentId) return null

  if (session.workspace?.type === 'system') {
    return { agentId: session.agentId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
  }

  if (session.workspaceId) {
    return {
      agentId: session.agentId,
      workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: session.workspaceId }
    }
  }

  if (session.workspace?.path) {
    return { agentId: session.agentId, workspacePath: session.workspace.path }
  }

  return { agentId: session.agentId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
}

export function findLatestSessionCreationDefaults(
  sessions: readonly SessionListItem[],
  predicate: (session: SessionListItem) => boolean = () => true
): SessionCreationDefaults | null {
  let latestSession: SessionListItem | null = null
  let latestActivityAtMs = Number.NEGATIVE_INFINITY

  for (const session of sessions) {
    if (session.pinned || !predicate(session)) continue

    const parsedActivityAtMs = Date.parse(session.lastActivityAt)
    const activityAtMs = Number.isFinite(parsedActivityAtMs) ? parsedActivityAtMs : Number.NEGATIVE_INFINITY
    if (!latestSession || activityAtMs > latestActivityAtMs) {
      latestSession = session
      latestActivityAtMs = activityAtMs
    }
  }

  return buildSessionCreationDefaults(latestSession)
}

const Sessions = ({
  agentSessionsSource,
  activeSession,
  activeSessionId,
  agentIdFilter,
  historyRecordsActive,
  onActiveAgentDeleted,
  onAddAgent,
  onOpenHistoryRecords,
  onSetPanePosition,
  onCreateSession,
  onShowMissingAgentSelection,
  panePosition,
  presentation = 'sidebar',
  revealRequest,
  resourceMenuItems,
  setActiveSessionId: setControlledActiveSessionId
}: SessionsProps) => {
  const { t } = useTranslation()
  const closeConversationTabs = useCloseConversationTabs()
  const isRightPanel = presentation === 'right-panel'
  const conversationNav = useConversationNavigation('agents')
  const isWindowFrame = useWindowFrame().mode === 'window'
  const { notesPath } = useNotesSettings()
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
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [sessionSortBy, setSessionSortBy] = useTopicSessionSortPreference('agent.session.sort_type')
  const [storedPanePosition, setStoredPanePosition] = usePreference('agent.session.position')
  const [storedWorkdirSectionOrder, setStoredWorkdirSectionOrder] = usePreference('agent.session.workdir_section_order')
  // Agent session icon style is stored under its own key so it no longer mutates the assistant's.
  const [assistantIconType, setAssistantIconType] = usePreference('agent.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const resolvedPanePosition = panePosition ?? storedPanePosition
  const setResolvedPanePosition =
    panePosition === undefined ? (onSetPanePosition ?? setStoredPanePosition) : onSetPanePosition
  const workdirSectionOrder = useMemo(
    () => normalizeWorkdirSectionOrder(storedWorkdirSectionOrder),
    [storedWorkdirSectionOrder]
  )
  const workdirSectionRank = useMemo(
    () => new Map(workdirSectionOrder.map((section, index) => [section, index])),
    [workdirSectionOrder]
  )
  const [sessionExpansionAgent, setSessionExpansionAgent] = usePersistCache('ui.agent.session.expansion.agent')
  const [sessionExpansionWorkdir, setSessionExpansionWorkdir] = usePersistCache('ui.agent.session.expansion.workdir')
  const { loadLatestSession, stats: globalSessionStats } = agentSessionsSource
  const { agents, error: agentsError, isLoading: isAgentsLoading, refetch: refetchAgents } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [optimisticAgentOrderIds, setOptimisticAgentOrderIds] = useState<string[] | null>(null)
  const [optimisticWorkspaceOrderIds, setOptimisticWorkspaceOrderIds] = useState<string[] | null>(null)
  const [optimisticallyRemovedSessionIds, setOptimisticallyRemovedSessionIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [optimisticSessionNames, setOptimisticSessionNames] = useState<Record<string, string>>({})
  const [creatingSession, setCreatingSession] = useState(false)
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [deletingWorkspaceGroupId, setDeletingWorkspaceGroupId] = useState<string | null>(null)
  const [renamingWorkspaceGroup, setRenamingWorkspaceGroup] = useState<{
    name: string
    workspaceId: string
  } | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const { queueTarget: queueImageCaptureTarget, targets: imageCaptureTargets } =
    useImageCaptureTargets<AgentSessionEntity>({
      cancelMessage: 'Agent session image export was cancelled',
      delayMs: IMAGE_CAPTURE_START_DELAY_MS,
      rejectPendingActions: rejectPendingAgentSessionImageActions
    })

  const { data: channels } = useQuery('/agent-channels')
  const channelTypeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ch of channels ?? []) {
      if (ch.sessionId) map[ch.sessionId] = ch.type
    }
    return map
  }, [channels])

  const displayMode: AgentSessionDisplayMode = isRightPanel
    ? 'time'
    : sessionDisplayMode === 'workdir' || sessionDisplayMode === 'agent'
      ? sessionDisplayMode
      : 'time'
  const defaultGroupVisibleCount =
    displayMode === 'time' ? Number.POSITIVE_INFINITY : DEFAULT_SESSION_GROUP_VISIBLE_COUNT
  const sessionExpansion =
    displayMode === 'agent' ? sessionExpansionAgent : displayMode === 'workdir' ? sessionExpansionWorkdir : undefined

  const [remoteQuery, setRemoteQuery] = useState('')
  const debouncedRemoteQuery = useDebouncedValue(remoteQuery, SESSION_SEARCH_DEBOUNCE_MS)
  const isSessionListEnabled = !isRightPanel || !!agentIdFilter
  const rightPanelAgentScope = isRightPanel && agentIdFilter ? agentIdFilter : undefined
  const sessionStatsQuery = useMemo(
    () => ({
      ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery } : {}),
      ...(rightPanelAgentScope ? { agentId: rightPanelAgentScope } : {})
    }),
    [debouncedRemoteQuery, rightPanelAgentScope]
  )
  const pinnedSessionsSource = useSessions(rightPanelAgentScope, {
    enabled: isSessionListEnabled,
    pageSize: SESSION_PAGE_SIZE,
    pinned: true,
    q: debouncedRemoteQuery,
    searchScope: 'name'
  })
  const {
    deleteSession,
    loadMore: loadMorePinnedSessions,
    reload: reloadPinnedSessions,
    reorderSession,
    sessions: pinnedSessions
  } = pinnedSessionsSource
  const ordinarySessionsSource = useSessions(rightPanelAgentScope, {
    enabled: isSessionListEnabled && displayMode === 'time',
    pageSize: SESSION_PAGE_SIZE,
    pinned: false,
    q: debouncedRemoteQuery,
    searchScope: 'name',
    sortBy: sessionSortBy
  })
  const {
    hasMore: hasMoreOrdinarySessions,
    isLoading: isOrdinarySessionsLoading,
    isValidating: isOrdinarySessionsValidating,
    loadMore: loadMoreOrdinarySessions,
    reload: reloadOrdinarySessions,
    sessions: ordinarySessions
  } = ordinarySessionsSource
  const {
    stats: sessionStats,
    isLoading: isSessionStatsLoading,
    error: sessionStatsError,
    refetch: refetchSessionStats
  } = useAgentSessionStats({ enabled: isSessionListEnabled, query: sessionStatsQuery })
  const { pin: pinSession, unpin: unpinSession, isMutating: isSessionPinMutating } = usePinMutations('session')

  const {
    isLoading: isAgentPinsLoading,
    isRefreshing: isAgentPinsRefreshing,
    isMutating: isAgentPinsMutating,
    pinnedIds: agentPinnedIds,
    togglePin: toggleAgentPin
  } = usePins('agent', { enabled: displayMode === 'agent' })
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating

  const { updateSession } = useUpdateSession()

  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const agentsForDisplay = useMemo(() => {
    if (!optimisticAgentOrderIds) return agents

    const agentById = new Map(agents.map((agent) => [agent.id, agent]))
    const orderedAgents = optimisticAgentOrderIds.flatMap((agentId) => {
      const agent = agentById.get(agentId)
      return agent ? [agent] : []
    })
    const optimisticIds = new Set(optimisticAgentOrderIds)

    for (const agent of agents) {
      if (!optimisticIds.has(agent.id)) {
        orderedAgents.push(agent)
      }
    }

    return orderedAgents
  }, [agents, optimisticAgentOrderIds])
  const agentById = useMemo(() => new Map(agentsForDisplay.map((agent) => [agent.id, agent])), [agentsForDisplay])
  const getSessionExportOptions = useCallback(
    (session: AgentSessionEntity): AgentSessionExportOptions => ({
      modelFallback: getAgentModelFallbackSnapshot(session.agentId ? agentById.get(session.agentId) : undefined)
    }),
    [agentById]
  )
  const agentRankById = useMemo(
    () => new Map(agentsForDisplay.map((agent, index) => [agent.id, index])),
    [agentsForDisplay]
  )
  const {
    data: workspaces,
    error: workspacesError,
    isLoading: isWorkspacesLoading,
    isRefreshing: isWorkspacesRefreshing,
    refetch: refetchWorkspaces
  } = useQuery('/agent-workspaces', { enabled: displayMode === 'workdir' })
  const workspaceRows = workspaces ?? EMPTY_WORKSPACE_ROWS
  const isWorkdirMetadataLoading = displayMode === 'workdir' && isWorkspacesLoading
  const isWorkdirMetadataRefreshing = displayMode === 'workdir' && isWorkspacesRefreshing
  const workdirDragReady = displayMode === 'workdir' && !isWorkdirMetadataLoading && !isWorkdirMetadataRefreshing
  const agentDragReady = displayMode === 'agent' && !isAgentsLoading
  // Group (workspace/agent) reordering is independent of the session sort — it
  // stays available on timestamp sorts. Session ITEM drag additionally requires
  // manual (`orderKey`) sort.
  const groupDragReady = displayMode === 'agent' ? agentDragReady : workdirDragReady
  const itemDragReady =
    !isRightPanel &&
    sessionSortBy === 'orderKey' &&
    (displayMode !== 'time' || (!isOrdinarySessionsLoading && !isOrdinarySessionsValidating))
  const workspaceRowsForDisplay = useMemo(() => {
    if (!optimisticWorkspaceOrderIds) return workspaceRows

    const workspaceById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace]))
    const orderedWorkspaces: typeof workspaceRows = []
    for (const workspaceId of optimisticWorkspaceOrderIds) {
      const workspace = workspaceById.get(workspaceId)
      if (workspace) {
        orderedWorkspaces.push(workspace)
      }
    }
    const orderedIds = new Set(orderedWorkspaces.map((workspace) => workspace.id))
    const remainingWorkspaces = workspaceRows.filter((workspace) => !orderedIds.has(workspace.id))

    return [...orderedWorkspaces, ...remainingWorkspaces]
  }, [optimisticWorkspaceOrderIds, workspaceRows])
  const statsWorkspaceIds = useMemo(
    () =>
      (sessionStats?.byWorkspace ?? [])
        .map((entry) => entry.workspaceId)
        .filter((workspaceId) => workspaceId !== 'system'),
    [sessionStats]
  )
  const workdirDisplay = useMemo(
    () => createSessionWorkdirDisplayMaps([], workspaceRowsForDisplay, [], statsWorkspaceIds),
    [statsWorkspaceIds, workspaceRowsForDisplay]
  )
  const agentSessionStatsByGroupId = useMemo(() => {
    const result = new Map<string, { count: number; pinnedCount: number }>()
    for (const entry of sessionStats?.byAgent ?? []) {
      const groupId =
        entry.agentId && agentById.has(entry.agentId)
          ? getSessionAgentGroupId(entry.agentId)
          : SESSION_UNLINKED_AGENT_GROUP_ID
      const current = result.get(groupId) ?? { count: 0, pinnedCount: 0 }
      current.count += entry.count
      current.pinnedCount += entry.pinnedCount
      result.set(groupId, current)
    }
    return result
  }, [agentById, sessionStats])
  const orderedAgentSessionGroupIds = useMemo(() => {
    const groupIds = agentsForDisplay
      .map((agent) => getSessionAgentGroupId(agent.id))
      .filter((groupId) => {
        const stats = agentSessionStatsByGroupId.get(groupId)
        return !!stats && stats.count - stats.pinnedCount > 0
      })
    const unlinkedStats = agentSessionStatsByGroupId.get(SESSION_UNLINKED_AGENT_GROUP_ID)
    if (unlinkedStats && unlinkedStats.count - unlinkedStats.pinnedCount > 0) {
      groupIds.push(SESSION_UNLINKED_AGENT_GROUP_ID)
    }
    return groupIds
  }, [agentSessionStatsByGroupId, agentsForDisplay])
  const sessionOwnerFallbackAgentIds = useMemo(() => {
    const globalCountByAgentId = new Map(
      (globalSessionStats?.byAgent ?? []).flatMap((entry) =>
        entry.agentId ? ([[entry.agentId, entry.count]] as const) : []
      )
    )
    return agentsForDisplay.filter((agent) => (globalCountByAgentId.get(agent.id) ?? 0) > 0).map((agent) => agent.id)
  }, [agentsForDisplay, globalSessionStats])
  const workdirSessionStatsByGroupId = useMemo(() => {
    const result = new Map<string, { count: number; pinnedCount: number }>()
    for (const entry of sessionStats?.byWorkspace ?? []) {
      const groupId =
        entry.workspaceId === 'system'
          ? SESSION_SYSTEM_WORKSPACE_GROUP_ID
          : getWorkspaceSessionGroupId(entry.workspaceId)
      const current = result.get(groupId) ?? { count: 0, pinnedCount: 0 }
      current.count += entry.count
      current.pinnedCount += entry.pinnedCount
      result.set(groupId, current)
    }
    return result
  }, [sessionStats])
  const globalWorkdirSessionCountByGroupId = useMemo(() => {
    const result = new Map<string, number>()
    for (const entry of globalSessionStats?.byWorkspace ?? []) {
      const groupId =
        entry.workspaceId === 'system'
          ? SESSION_SYSTEM_WORKSPACE_GROUP_ID
          : getWorkspaceSessionGroupId(entry.workspaceId)
      result.set(groupId, (result.get(groupId) ?? 0) + entry.count)
    }
    return result
  }, [globalSessionStats])
  const orderedWorkdirSessionGroupIds = useMemo(
    () =>
      [...workdirSessionStatsByGroupId.entries()]
        .filter(([, stats]) => stats.count - stats.pinnedCount > 0)
        .map(([groupId]) => groupId)
        .sort((a, b) => {
          const aRank =
            a === SESSION_SYSTEM_WORKSPACE_GROUP_ID ? Number.MAX_SAFE_INTEGER : workdirDisplay.rankByGroupId.get(a)
          const bRank =
            b === SESSION_SYSTEM_WORKSPACE_GROUP_ID ? Number.MAX_SAFE_INTEGER : workdirDisplay.rankByGroupId.get(b)
          return (aRank ?? Number.MAX_SAFE_INTEGER - 1) - (bRank ?? Number.MAX_SAFE_INTEGER - 1)
        }),
    [workdirDisplay.rankByGroupId, workdirSessionStatsByGroupId]
  )
  const activeOrdinarySessionGroupId = useMemo(() => {
    if (!activeSession || pinnedSessions.some((session) => session.id === activeSession.id)) return undefined
    if (displayMode === 'agent') {
      return activeSession.agentId && agentById.has(activeSession.agentId)
        ? getSessionAgentGroupId(activeSession.agentId)
        : SESSION_UNLINKED_AGENT_GROUP_ID
    }
    if (displayMode !== 'workdir') return undefined
    if (isSystemWorkspaceSession(activeSession)) return SESSION_SYSTEM_WORKSPACE_GROUP_ID
    return getSessionWorkdirGroupId(activeSession, workdirDisplay)
  }, [activeSession, agentById, displayMode, pinnedSessions, workdirDisplay])
  const collapsedSessionGroupIds = useMemo(() => {
    if (displayMode === 'agent') {
      return (
        sessionExpansionAgent ??
        orderedAgentSessionGroupIds.filter((groupId) => groupId !== activeOrdinarySessionGroupId)
      )
    }
    if (displayMode !== 'workdir') return []
    if (!sessionExpansionWorkdir) {
      return orderedWorkdirSessionGroupIds.filter((groupId) => groupId !== activeOrdinarySessionGroupId)
    }
    return remapResourceListCollapsedGroupIds(sessionExpansionWorkdir, (groupId) => {
      const path = getWorkdirPathFromSessionGroupId(groupId)
      return path ? (workdirDisplay.groupIdByPath.get(path) ?? groupId) : groupId
    })
  }, [
    displayMode,
    activeOrdinarySessionGroupId,
    orderedAgentSessionGroupIds,
    orderedWorkdirSessionGroupIds,
    sessionExpansionAgent,
    sessionExpansionWorkdir,
    workdirDisplay.groupIdByPath
  ])
  const initialSessionGroupIds = useMemo(() => {
    const groupIds =
      displayMode === 'agent'
        ? orderedAgentSessionGroupIds
        : displayMode === 'workdir'
          ? orderedWorkdirSessionGroupIds
          : []
    return groupIds.filter((groupId) => !collapsedSessionGroupIds.includes(groupId))
  }, [collapsedSessionGroupIds, displayMode, orderedAgentSessionGroupIds, orderedWorkdirSessionGroupIds])
  const fetchSessionGroupPage = useCallback(
    async (groupId: string, cursor?: string) => {
      const commonQuery = {
        cursor,
        limit: SESSION_PAGE_SIZE,
        pinned: false,
        ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery, searchScope: 'name' as const } : {}),
        sortBy: sessionSortBy
      }

      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(groupId)
        const ownerScope = groupId === SESSION_UNLINKED_AGENT_GROUP_ID ? 'unlinked' : agentId
        if (!ownerScope) return { items: [] }
        return dataApiService.get('/agent-sessions', { query: { ...commonQuery, agentId: ownerScope } })
      }

      if (displayMode === 'workdir') {
        const workspaceId =
          groupId === SESSION_SYSTEM_WORKSPACE_GROUP_ID || groupId === SESSION_NO_WORKDIR_GROUP_ID
            ? 'system'
            : (workdirDisplay.workspaceIdByGroupId.get(groupId) ?? getWorkspaceIdFromSessionGroupId(groupId))
        if (!workspaceId) return { items: [] }
        return dataApiService.get('/agent-sessions', { query: { ...commonQuery, workspaceId } })
      }

      return { items: [] }
    },
    [debouncedRemoteQuery, displayMode, sessionSortBy, workdirDisplay.workspaceIdByGroupId]
  )
  const getSessionResourceItemId = useCallback((session: AgentSessionListItem) => session.id, [])
  const {
    items: sessionGroupWindowItems,
    loadGroup: loadSessionGroupWindow,
    loadMoreGroup: loadMoreSessionGroupWindow,
    refillGroup: refillSessionGroupWindow,
    reset: resetSessionGroupWindows,
    windows: sessionGroupWindows
  } = useCursorGroupWindows<AgentSessionListItem>({
    continuityKey: JSON.stringify({ mode: displayMode, q: debouncedRemoteQuery }),
    enabled: isSessionListEnabled && displayMode !== 'time',
    fetchPage: fetchSessionGroupPage,
    getItemId: getSessionResourceItemId,
    groupIds: displayMode === 'agent' ? orderedAgentSessionGroupIds : orderedWorkdirSessionGroupIds,
    initialGroupIds: initialSessionGroupIds,
    queryKey: JSON.stringify({
      groups:
        displayMode === 'agent'
          ? orderedAgentSessionGroupIds
          : displayMode === 'workdir'
            ? orderedWorkdirSessionGroupIds
            : [],
      mode: displayMode,
      q: debouncedRemoteQuery,
      sortBy: sessionSortBy
    })
  })
  const fetchAnchoredSessionPage = useCallback(
    async (identity: { band: 'pinned' | 'ordinary'; groupId: string }, cursor: string) => {
      const commonQuery = {
        cursor,
        limit: SESSION_PAGE_SIZE,
        pinned: identity.band === 'pinned',
        ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery, searchScope: 'name' as const } : {}),
        ...(identity.band === 'ordinary' ? { sortBy: sessionSortBy } : {})
      }
      if (rightPanelAgentScope) {
        return dataApiService.get('/agent-sessions', {
          query: { ...commonQuery, agentId: rightPanelAgentScope }
        })
      }
      if (identity.band === 'ordinary' && displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(identity.groupId)
        const ownerScope = identity.groupId === SESSION_UNLINKED_AGENT_GROUP_ID ? 'unlinked' : agentId
        if (ownerScope) {
          return dataApiService.get('/agent-sessions', { query: { ...commonQuery, agentId: ownerScope } })
        }
      }
      if (identity.band === 'ordinary' && displayMode === 'workdir') {
        const workspaceId =
          identity.groupId === SESSION_SYSTEM_WORKSPACE_GROUP_ID || identity.groupId === SESSION_NO_WORKDIR_GROUP_ID
            ? 'system'
            : (workdirDisplay.workspaceIdByGroupId.get(identity.groupId) ??
              getWorkspaceIdFromSessionGroupId(identity.groupId))
        if (workspaceId) {
          return dataApiService.get('/agent-sessions', { query: { ...commonQuery, workspaceId } })
        }
      }
      return dataApiService.get('/agent-sessions', { query: commonQuery })
    },
    [debouncedRemoteQuery, displayMode, rightPanelAgentScope, sessionSortBy, workdirDisplay.workspaceIdByGroupId]
  )
  const {
    clear: clearAnchoredSessionWindow,
    isLoading: isAnchoredSessionWindowLoading,
    loadMoreGroup: loadMoreAnchoredSessionGroup,
    loadPreviousGroup: loadPreviousAnchoredSessionGroup,
    replace: replaceAnchoredSessionWindow,
    window: anchoredSessionWindow
  } = useAnchoredResourceWindow<AgentSessionListItem>({
    fetchPage: fetchAnchoredSessionPage,
    getItemId: getSessionResourceItemId,
    resetKey: JSON.stringify({
      agentScope: rightPanelAgentScope,
      displayMode,
      q: debouncedRemoteQuery,
      sortBy: sessionSortBy
    })
  })
  const getSessionDisplayGroupId = useCallback(
    (session: AgentSessionListItem) => {
      if (session.pinned) return SESSION_PINNED_GROUP_ID
      if (displayMode === 'time') return SESSION_ORDINARY_GROUP_ID
      if (displayMode === 'agent') {
        return session.agentId && agentById.has(session.agentId)
          ? getSessionAgentGroupId(session.agentId)
          : SESSION_UNLINKED_AGENT_GROUP_ID
      }
      if (isSystemWorkspaceSession(session)) return SESSION_SYSTEM_WORKSPACE_GROUP_ID
      return getSessionWorkdirGroupId(session, workdirDisplay)
    },
    [agentById, displayMode, workdirDisplay]
  )
  const commitSessionPin = useCallback(
    async (session: AgentSessionListItem) => {
      if (session.pinId) {
        await unpinSession(session.pinId)
      } else {
        await pinSession(session.id)
      }
    },
    [pinSession, unpinSession]
  )
  const sourceSessionItems = useMemo<AgentSessionListItem[]>(() => {
    const byId = new Map<string, AgentSessionListItem>()
    for (const session of displayMode === 'time' ? ordinarySessions : sessionGroupWindowItems) {
      if (
        anchoredSessionWindow?.band === 'ordinary' &&
        getSessionDisplayGroupId(session) === anchoredSessionWindow.groupId
      ) {
        continue
      }
      byId.set(session.id, session)
    }
    for (const session of anchoredSessionWindow?.band === 'pinned' ? [] : pinnedSessions) {
      byId.set(session.id, session)
    }
    for (const session of anchoredSessionWindow?.items ?? []) byId.set(session.id, session)
    return [...byId.values()]
  }, [
    anchoredSessionWindow,
    displayMode,
    getSessionDisplayGroupId,
    ordinarySessions,
    pinnedSessions,
    sessionGroupWindowItems
  ])
  useEffect(() => {
    if (anchoredSessionWindow && activeSessionId !== anchoredSessionWindow.anchorId) clearAnchoredSessionWindow()
  }, [activeSessionId, anchoredSessionWindow, clearAnchoredSessionWindow])
  const { items: projectedSessionItems, togglePinned: togglePinnedSessionItem } = useResourceListPinnedItems({
    disabled: isSessionPinMutating,
    items: sourceSessionItems,
    onTogglePin: commitSessionPin,
    resetKey: JSON.stringify({ agentScope: rightPanelAgentScope, displayMode, q: debouncedRemoteQuery })
  })
  const sessionItems = useMemo(
    () =>
      projectedSessionItems
        .filter((session) => !optimisticallyRemovedSessionIds.has(session.id))
        .map((session) =>
          optimisticSessionNames[session.id] === undefined
            ? session
            : { ...session, name: optimisticSessionNames[session.id] }
        ),
    [optimisticSessionNames, optimisticallyRemovedSessionIds, projectedSessionItems]
  )
  useEffect(() => {
    const sourceIds = new Set(sourceSessionItems.map((session) => session.id))
    setOptimisticallyRemovedSessionIds((current) => {
      const next = new Set([...current].filter((id) => sourceIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [sourceSessionItems])
  useEffect(() => {
    const sourceNameById = new Map(sourceSessionItems.map((session) => [session.id, session.name]))
    setOptimisticSessionNames((current) => {
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
  }, [sourceSessionItems])
  const optimisticallyRemoveSession = useCallback((session: AgentSessionListItem) => {
    setOptimisticallyRemovedSessionIds((current) =>
      current.has(session.id) ? current : new Set([...current, session.id])
    )
  }, [])
  const restoreOptimisticallyRemovedSession = useCallback((session: AgentSessionListItem) => {
    setOptimisticallyRemovedSessionIds((current) => {
      if (!current.has(session.id)) return current
      const next = new Set(current)
      next.delete(session.id)
      return next
    })
  }, [])
  const sessionItemsRef = useRef(sessionItems)
  const activeSessionIdRef = useRef(activeSessionId)
  const previousRevealDisplayModeRef = useRef(displayMode)
  const modeRevealRequestIdRef = useRef(0)
  const incomingRevealRequestKey = revealRequest ? `${revealRequest.requestId}:${revealRequest.itemId}` : null
  const [modeRevealRequest, setModeRevealRequest] = useState<{
    incomingRequestKey: string | null
    request?: ResourceListRevealRequest
  }>()
  const effectiveRevealRequest =
    modeRevealRequest?.incomingRequestKey === incomingRevealRequestKey ? modeRevealRequest.request : revealRequest
  const commitActiveSession = useCallback(
    (id: string | null, selectedSession?: AgentSessionEntity | null) => {
      activeSessionIdRef.current = id
      const session =
        selectedSession === undefined
          ? id
            ? (sessionItemsRef.current.find((candidate) => candidate.id === id) ?? null)
            : null
          : selectedSession
      setControlledActiveSessionId(id, session)
    },
    [setControlledActiveSessionId]
  )
  const activateOwnerSession = useCallback(
    (session: AgentSessionEntity) => commitActiveSession(session.id, session),
    [commitActiveSession]
  )
  const loadLatestSessionForOwner = useCallback((agentId: string) => loadLatestSession(agentId), [loadLatestSession])
  const { activateOwnerResource, cancelOwnerResourceActivation } = useOwnerResourceActivation({
    loadResourceForOwner: loadLatestSessionForOwner,
    onActivateResource: activateOwnerSession
  })

  useEffect(() => {
    sessionItemsRef.current = sessionItems
  }, [sessionItems])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
    cancelOwnerResourceActivation()
  }, [activeSessionId, cancelOwnerResourceActivation])

  useEffect(() => {
    if (previousRevealDisplayModeRef.current === displayMode) return
    previousRevealDisplayModeRef.current = displayMode
    const request =
      revealRequest?.itemId === activeSessionId
        ? revealRequest
        : activeSessionId
          ? { itemId: activeSessionId, requestId: 0 }
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
  }, [activeSessionId, displayMode, incomingRevealRequestKey, revealRequest])

  const setActiveSessionId = useCallback(
    (id: string | null, selectedSession?: AgentSessionEntity | null) => {
      cancelOwnerResourceActivation()
      commitActiveSession(id, selectedSession)
    },
    [cancelOwnerResourceActivation, commitActiveSession]
  )
  const toggleSessionPin = useCallback(
    async (sessionId: string) => {
      if (isSessionPinMutating) return false
      const session = sessionItemsRef.current.find((candidate) => candidate.id === sessionId)
      if (!session) return false
      try {
        await togglePinnedSessionItem(session)
        return true
      } catch (err) {
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.pin.error.failed')))
        return false
      }
    },
    [isSessionPinMutating, t, togglePinnedSessionItem]
  )
  const reloadSessionViews = useCallback(async () => {
    resetSessionGroupWindows()
    await Promise.all([reloadPinnedSessions(), reloadOrdinarySessions(), refetchSessionStats()])
  }, [refetchSessionStats, reloadOrdinarySessions, reloadPinnedSessions, resetSessionGroupWindows])
  const workspaceOrderSignature = useMemo(
    () => workspaceRows.map((workspace) => `${workspace.id}:${workspace.orderKey}`).join('|'),
    [workspaceRows]
  )
  const agentOrderSignature = useMemo(
    () => agents.map((agent) => `${agent.id}:${agent.orderKey ?? ''}`).join('|'),
    [agents]
  )

  const baseGroupedSessions = useMemo(() => {
    const sorted = sortSessionsForDisplayGroups(sessionItems, {
      agentRankById,
      mode: displayMode,
      sortBy: sessionSortBy,
      workdirDisplay
    })
    if (displayMode !== 'workdir') return sorted

    return sorted
      .map((session, index) => ({ session, index }))
      .sort((a, b) => {
        const getRank = (session: SessionListItem) => {
          if (session.pinned) return -1
          const section = isSystemWorkspaceSession(session) ? 'no-workdir' : 'workdir'
          return workdirSectionRank.get(section) ?? Number.MAX_SAFE_INTEGER
        }
        return getRank(a.session) - getRank(b.session) || a.index - b.index
      })
      .map(({ session }) => session)
  }, [agentRankById, displayMode, sessionItems, sessionSortBy, workdirDisplay, workdirSectionRank])

  const groupedSessions = useMemo(
    () =>
      optimisticMove ? applyOptimisticSessionDisplayMove(baseGroupedSessions, optimisticMove) : baseGroupedSessions,
    [baseGroupedSessions, optimisticMove]
  )
  const filteredGroupedSessions = useMemo(() => {
    if (!isRightPanel) return groupedSessions
    if (!agentIdFilter) return []
    return groupedSessions.filter((session) => session.agentId === agentIdFilter)
  }, [agentIdFilter, groupedSessions, isRightPanel])
  const headerSessionCreationDefaults = useMemo(
    () =>
      isRightPanel
        ? agentIdFilter
          ? { agentId: agentIdFilter, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
          : null
        : findLatestSessionCreationDefaults(filteredGroupedSessions),
    [agentIdFilter, filteredGroupedSessions, isRightPanel]
  )

  const sessionOrderSignature = useMemo(
    () =>
      sessionItems
        .map((session) => `${session.id}:${session.agentId ?? ''}:${session.orderKey}:${session.pinned ? '1' : '0'}`)
        .join('|'),
    [sessionItems]
  )

  useEffect(() => {
    setOptimisticMove(null)
  }, [sessionOrderSignature])

  useEffect(() => {
    setOptimisticWorkspaceOrderIds(null)
  }, [workspaceOrderSignature])

  useEffect(() => {
    setOptimisticAgentOrderIds(null)
  }, [agentOrderSignature])

  const ordinarySessionGroupLabel = t('agent.session.list.title')
  const sessionGroupBy = useMemo(
    () =>
      createSessionDisplayGroupResolver({
        agentById,
        labels: {
          pinned: t('selector.common.pinned_title'),
          ordinary: ordinarySessionGroupLabel,
          agent: {
            unlinked: t('agent.session.group.unknown_agent')
          },
          workdir: {
            none: t('agent.session.group.no_workdir')
          }
        },
        mode: displayMode,
        pinnedAsSection: displayMode !== 'time',
        workdirDisplay
      }),
    [agentById, displayMode, ordinarySessionGroupLabel, t, workdirDisplay]
  )

  const sessionSectionBy = useMemo(() => {
    if (displayMode === 'time') return undefined

    return (session: SessionListItem): ResourceListSection => {
      if (session.pinned) {
        return { id: SESSION_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      }

      if (displayMode === 'workdir' && isSystemWorkspaceSession(session)) {
        return { id: SESSION_SYSTEM_WORKSPACE_SECTION_ID, label: t('agent.session.group.no_workdir') }
      }

      return {
        id: displayMode === 'agent' ? SESSION_AGENT_SECTION_ID : SESSION_WORKDIR_SECTION_ID,
        label: t(SESSION_DISPLAY_LABEL_KEYS[displayMode])
      }
    }
  }, [displayMode, t])

  const sessionGroupSeeds = useMemo<ResourceListGroupSeed[]>(() => {
    const seeds: ResourceListGroupSeed[] = []
    const pinnedCount = sessionStats?.pinnedCount ?? 0
    if (pinnedCount > 0 || pinnedSessionsSource.error) {
      seeds.push({
        id: SESSION_PINNED_GROUP_ID,
        label: displayMode === 'time' ? t('selector.common.pinned_title') : '',
        count: pinnedCount,
        section:
          displayMode === 'time'
            ? undefined
            : { id: SESSION_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      })
    }

    if (displayMode === 'time') {
      const ordinaryCount = Math.max(0, (sessionStats?.total ?? 0) - pinnedCount)
      if (ordinaryCount > 0 || ordinarySessionsSource.error) {
        seeds.push({ id: SESSION_ORDINARY_GROUP_ID, label: ordinarySessionGroupLabel, count: ordinaryCount })
      }
      return seeds
    }

    if (displayMode === 'agent') {
      for (const groupId of orderedAgentSessionGroupIds) {
        const stats = agentSessionStatsByGroupId.get(groupId)
        const count = stats ? stats.count - stats.pinnedCount : 0
        if (count <= 0) continue
        const agentId = getAgentIdFromSessionGroupId(groupId)
        seeds.push({
          id: groupId,
          label: (agentId ? agentById.get(agentId)?.name : undefined) || t('agent.session.group.unknown_agent'),
          count,
          section: { id: SESSION_AGENT_SECTION_ID, label: t(SESSION_DISPLAY_LABEL_KEYS.agent) }
        })
      }
      return seeds
    }

    for (const groupId of orderedWorkdirSessionGroupIds) {
      const stats = workdirSessionStatsByGroupId.get(groupId)
      const count = stats ? stats.count - stats.pinnedCount : 0
      if (count <= 0) continue
      const isSystemGroup = groupId === SESSION_SYSTEM_WORKSPACE_GROUP_ID
      seeds.push({
        id: groupId,
        label: isSystemGroup ? '' : (workdirDisplay.labelByGroupId.get(groupId) ?? t('agent.session.group.no_workdir')),
        count,
        section: isSystemGroup
          ? { id: SESSION_SYSTEM_WORKSPACE_SECTION_ID, label: t('agent.session.group.no_workdir') }
          : { id: SESSION_WORKDIR_SECTION_ID, label: t(SESSION_DISPLAY_LABEL_KEYS.workdir) }
      })
    }
    seeds.sort((a, b) => {
      if (a.id === SESSION_PINNED_GROUP_ID) return -1
      if (b.id === SESSION_PINNED_GROUP_ID) return 1
      const aSection = a.section ? getWorkdirSectionFromId(a.section.id) : undefined
      const bSection = b.section ? getWorkdirSectionFromId(b.section.id) : undefined
      return (
        (aSection ? (workdirSectionRank.get(aSection) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER) -
        (bSection ? (workdirSectionRank.get(bSection) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER)
      )
    })
    return seeds
  }, [
    agentById,
    agentSessionStatsByGroupId,
    displayMode,
    ordinarySessionGroupLabel,
    orderedAgentSessionGroupIds,
    orderedWorkdirSessionGroupIds,
    pinnedSessionsSource.error,
    sessionStats,
    t,
    ordinarySessionsSource.error,
    workdirDisplay.labelByGroupId,
    workdirSectionRank,
    workdirSessionStatsByGroupId
  ])
  const loadedSessionCountByGroupId = useMemo(() => {
    const result = new Map<string, number>()
    for (const session of sessionItems) {
      const groupId = sessionGroupBy(session)?.id
      if (groupId) result.set(groupId, (result.get(groupId) ?? 0) + 1)
    }
    return result
  }, [sessionGroupBy, sessionItems])
  const sessionGroupStates = useMemo(() => {
    const result: Record<string, ResourceListRemoteGroupState> = {}
    for (const seed of sessionGroupSeeds) {
      const loadedCount = loadedSessionCountByGroupId.get(seed.id) ?? 0
      const totalCount = seed.count ?? 0
      const anchored = anchoredSessionWindow?.groupId === seed.id ? anchoredSessionWindow : undefined
      if (seed.id === SESSION_PINNED_GROUP_ID) {
        result[seed.id] = {
          totalCount,
          hasMore: anchored ? !!anchored.nextCursor : loadedCount < totalCount || !!pinnedSessionsSource.error,
          hasPrevious: !!anchored?.previousCursor,
          status: pinnedSessionsSource.error
            ? 'error'
            : loadedCount === 0 && (pinnedSessionsSource.isLoading || pinnedSessionsSource.isValidating)
              ? 'loading'
              : loadedCount === 0
                ? 'empty'
                : 'idle'
        }
        continue
      }

      if (displayMode !== 'time') {
        const window = sessionGroupWindows[seed.id]
        result[seed.id] = {
          totalCount,
          hasMore: anchored ? !!anchored.nextCursor : window ? !!window.nextCursor : totalCount > 0,
          hasPrevious: !!anchored?.previousCursor,
          status: window?.status ?? (initialSessionGroupIds.includes(seed.id) ? 'loading' : 'idle')
        }
        continue
      }

      result[seed.id] = {
        totalCount,
        hasMore: anchored ? !!anchored.nextCursor : hasMoreOrdinarySessions || !!ordinarySessionsSource.error,
        hasPrevious: !!anchored?.previousCursor,
        status: ordinarySessionsSource.error
          ? 'error'
          : loadedCount === 0 && (isOrdinarySessionsLoading || isOrdinarySessionsValidating)
            ? 'loading'
            : loadedCount === 0
              ? 'empty'
              : 'idle'
      }
    }
    return result
  }, [
    anchoredSessionWindow,
    ordinarySessionsSource.error,
    displayMode,
    hasMoreOrdinarySessions,
    initialSessionGroupIds,
    isOrdinarySessionsLoading,
    isOrdinarySessionsValidating,
    loadedSessionCountByGroupId,
    pinnedSessionsSource.error,
    pinnedSessionsSource.isLoading,
    pinnedSessionsSource.isValidating,
    sessionGroupWindows,
    sessionGroupSeeds
  ])

  const collapsedSessionState = useMemo(() => {
    if (displayMode === 'time') return undefined
    const resolvedSessionExpansion =
      sessionExpansion ??
      sessionGroupSeeds
        .filter((group) => group.label && group.id !== activeOrdinarySessionGroupId)
        .map((group) => group.id)
    if (displayMode === 'agent') return resolvedSessionExpansion
    return remapResourceListCollapsedGroupIds(resolvedSessionExpansion, (groupId) => {
      const path = getWorkdirPathFromSessionGroupId(groupId)
      return path ? (workdirDisplay.groupIdByPath.get(path) ?? groupId) : groupId
    })
  }, [activeOrdinarySessionGroupId, displayMode, sessionExpansion, sessionGroupSeeds, workdirDisplay.groupIdByPath])

  const handleSessionCollapsedStateChange = useCallback(
    (nextCollapsedIds: string[]) => {
      if (displayMode === 'agent') setSessionExpansionAgent(nextCollapsedIds)
      else if (displayMode === 'workdir') setSessionExpansionWorkdir(nextCollapsedIds)
    },
    [displayMode, setSessionExpansionAgent, setSessionExpansionWorkdir]
  )
  const getSessionCreationDefaultsForGroup = useCallback(
    (groupId: string): SessionCreationDefaults | null => {
      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(groupId)
        return agentId && agentById.has(agentId) ? { agentId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } } : null
      }
      return findLatestSessionCreationDefaults(
        filteredGroupedSessions,
        (session) => sessionGroupBy(session)?.id === groupId
      )
    },
    [agentById, displayMode, filteredGroupedSessions, sessionGroupBy]
  )
  const resolveSessionCreationDefaultsForGroup = useCallback(
    async (groupId: string): Promise<SessionCreationDefaults | null> => {
      const loadedDefaults = getSessionCreationDefaultsForGroup(groupId)
      if (loadedDefaults || displayMode !== 'workdir') return loadedDefaults

      const workspaceId =
        groupId === SESSION_SYSTEM_WORKSPACE_GROUP_ID || groupId === SESSION_NO_WORKDIR_GROUP_ID
          ? 'system'
          : (workdirDisplay.workspaceIdByGroupId.get(groupId) ?? getWorkspaceIdFromSessionGroupId(groupId))
      if (!workspaceId) return null
      const page = await dataApiService.get('/agent-sessions', {
        query: { limit: 1, pinned: false, sortBy: 'lastActivityAt', workspaceId }
      })
      return buildSessionCreationDefaults(page.items[0])
    },
    [displayMode, getSessionCreationDefaultsForGroup, workdirDisplay.workspaceIdByGroupId]
  )
  const getActiveSessionId = useCallback(() => activeSessionIdRef.current, [])
  const clearSessionSelection = useCallback(() => setActiveSessionId(null), [setActiveSessionId])
  const refillSessionRemovalGroup = useCallback(
    async (snapshot: ResourceRemovalSnapshot<AgentSessionListItem>) => {
      const currentAnchoredWindow =
        anchoredSessionWindow?.groupId === snapshot.groupId &&
        anchoredSessionWindow.items.some((session) => session.id === snapshot.itemId)
          ? anchoredSessionWindow
          : undefined

      const getGroupScope = () => {
        if (snapshot.band !== 'ordinary') return {}
        if (displayMode === 'agent') {
          const agentId = getAgentIdFromSessionGroupId(snapshot.groupId)
          const ownerScope = snapshot.groupId === SESSION_UNLINKED_AGENT_GROUP_ID ? 'unlinked' : agentId
          return ownerScope ? { agentId: ownerScope } : {}
        }
        if (displayMode === 'workdir') {
          const workspaceId =
            snapshot.groupId === SESSION_SYSTEM_WORKSPACE_GROUP_ID || snapshot.groupId === SESSION_NO_WORKDIR_GROUP_ID
              ? 'system'
              : (workdirDisplay.workspaceIdByGroupId.get(snapshot.groupId) ??
                getWorkspaceIdFromSessionGroupId(snapshot.groupId))
          return workspaceId ? { workspaceId } : {}
        }
        return {}
      }

      if (currentAnchoredWindow) {
        const nextVisible = snapshot.groupItems[snapshot.displayedIndex + 1]
        const previousVisible = snapshot.groupItems[snapshot.displayedIndex - 1]
        const survivingAnchor = nextVisible ?? previousVisible
        if (survivingAnchor) {
          const result = await dataApiService.get('/agent-sessions/window', {
            query: {
              anchorId: survivingAnchor.id,
              limit: SESSION_PAGE_SIZE,
              sortBy: sessionSortBy,
              ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery, searchScope: 'name' as const } : {}),
              ...(rightPanelAgentScope ? { agentId: rightPanelAgentScope } : getGroupScope())
            }
          })
          if (result.status === 'FOUND') {
            const items = result.items
            const survivingAnchorIndex = items.findIndex((session) => session.id === survivingAnchor.id)
            const selectionIndex = nextVisible
              ? survivingAnchorIndex
              : items[survivingAnchorIndex + 1]
                ? survivingAnchorIndex + 1
                : survivingAnchorIndex
            const selected = items[selectionIndex]
            if (selected) {
              replaceAnchoredSessionWindow({
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

      if (snapshot.band === 'ordinary' && displayMode !== 'time') {
        clearAnchoredSessionWindow()
        const items = await refillSessionGroupWindow(snapshot.groupId, snapshot.loadedWindowSize)
        return { items }
      }

      const byId = new Map<string, AgentSessionListItem>()
      let cursor: string | undefined
      let nextCursor: string | undefined
      do {
        const page = await dataApiService.get('/agent-sessions', {
          query: {
            cursor,
            limit: SESSION_PAGE_SIZE,
            pinned: snapshot.band === 'pinned',
            ...(debouncedRemoteQuery ? { q: debouncedRemoteQuery, searchScope: 'name' as const } : {}),
            ...(rightPanelAgentScope ? { agentId: rightPanelAgentScope } : getGroupScope()),
            ...(snapshot.band === 'ordinary' ? { sortBy: sessionSortBy } : {})
          }
        })
        for (const session of page.items) byId.set(session.id, session)
        cursor = page.nextCursor
        nextCursor = page.nextCursor
      } while (byId.size < snapshot.loadedWindowSize && cursor)

      const items = [...byId.values()]
      if (snapshot.band === 'pinned') await reloadPinnedSessions()
      else await reloadOrdinarySessions()

      if (currentAnchoredWindow) {
        const selectionIndex = Math.min(snapshot.displayedIndex, Math.max(items.length - 1, 0))
        const selected = items[selectionIndex]
        if (selected) {
          replaceAnchoredSessionWindow({
            anchorId: selected.id,
            band: snapshot.band,
            groupId: snapshot.groupId,
            items,
            nextCursor
          })
        } else {
          clearAnchoredSessionWindow()
        }
      }
      return { items }
    },
    [
      anchoredSessionWindow,
      clearAnchoredSessionWindow,
      debouncedRemoteQuery,
      displayMode,
      refillSessionGroupWindow,
      reloadOrdinarySessions,
      reloadPinnedSessions,
      replaceAnchoredSessionWindow,
      rightPanelAgentScope,
      sessionSortBy,
      workdirDisplay.workspaceIdByGroupId
    ]
  )
  const resolveSessionOwnerFallback = useCallback(
    async (snapshot: ResourceRemovalSnapshot<AgentSessionListItem>) => {
      const deletedSession = snapshot.item
      const hasLiveOwner = !!deletedSession.agentId && agentById.has(deletedSession.agentId)
      const currentOwnerLatest = await loadLatestSession(hasLiveOwner ? deletedSession.agentId : null)
      if (currentOwnerLatest) return undefined

      const eligibleAgentIds = new Set(sessionOwnerFallbackAgentIds)
      const orderedEligibleAgentIds = agentsForDisplay
        .map((agent) => agent.id)
        .filter((agentId) => eligibleAgentIds.has(agentId) || agentId === deletedSession.agentId)
      const fallbackAgentIds = hasLiveOwner
        ? buildResourceOwnerFallbackIds(orderedEligibleAgentIds, deletedSession.agentId!)
        : orderedEligibleAgentIds.reverse()

      for (const agentId of fallbackAgentIds) {
        const latest = await loadLatestSession(agentId)
        if (latest) return { ...latest, pinned: false, pinId: null }
      }
      return null
    },
    [agentById, agentsForDisplay, loadLatestSession, sessionOwnerFallbackAgentIds]
  )
  const { remove: coordinateSessionRemoval } = useResourceRemovalCoordinator<AgentSessionListItem>({
    getActiveId: getActiveSessionId,
    getBand: (session) => (session.pinned ? 'pinned' : 'ordinary'),
    getGroupId: getSessionDisplayGroupId,
    getItemId: (session) => session.id,
    refillGroup: refillSessionRemovalGroup,
    resolveOwnerFallback: displayMode === 'agent' ? resolveSessionOwnerFallback : undefined,
    optimisticallyRemove: optimisticallyRemoveSession,
    restoreOptimisticRemoval: restoreOptimisticallyRemovedSession,
    selectItem: (session) => setActiveSessionId(session.id, session),
    clearSelection: clearSessionSelection
  })
  const handleDeleteSession = useCallback(
    async (id: string) => {
      const session =
        filteredGroupedSessions.find((candidate) => candidate.id === id) ??
        sessionItemsRef.current.find((candidate) => candidate.id === id)
      if (!session) return

      await coordinateSessionRemoval({
        item: session,
        displayedItems: filteredGroupedSessions,
        groupOrder: sessionGroupSeeds.map((group) => group.id),
        context: undefined,
        commit: () => deleteSession(id)
      })
    },
    [coordinateSessionRemoval, deleteSession, filteredGroupedSessions, sessionGroupSeeds]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessionItems.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      setOptimisticSessionNames((current) => ({ ...current, [id]: trimmedName }))
      try {
        const updatedSession = await updateSession(
          { id, name: trimmedName, isNameManuallyEdited: true },
          { showSuccessToast: false }
        )
        if (updatedSession) {
          toast.success(t('common.saved'))
        } else {
          setOptimisticSessionNames((current) => {
            if (current[id] !== trimmedName) return current
            const next = { ...current }
            delete next[id]
            return next
          })
        }
      } catch (err) {
        setOptimisticSessionNames((current) => {
          if (current[id] !== trimmedName) return current
          const next = { ...current }
          delete next[id]
          return next
        })
        logger.error('Failed to rename session', { err, sessionId: id })
        toast.error(t('agent.session.update.error.failed'))
      }
    },
    [sessionItems, t, updateSession]
  )

  const handleAutoRenameSession = useCallback(
    async (session: AgentSessionEntity) => {
      const messages = await getAgentSessionMessagesForExport(session)
      if (messages.length < 2) return

      const topicId = buildAgentSessionTopicId(session.id)
      startTopicRenaming(topicId)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          await updateSession(
            { id: session.id, name: summaryText, isNameManuallyEdited: false },
            { showSuccessToast: false }
          )
        } else if (summaryError) {
          toast.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topicId)
      }
    },
    [t, updateSession]
  )

  const showSessionImageExportToast = useCallback(
    (request: AgentSessionImageActionRequest) => {
      const key = `agent-session-image-export:${request.id}`
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

  const handleSessionImageAction = useCallback(
    (type: AgentSessionImageActionType, session: AgentSessionEntity) => {
      const request = requestAgentSessionImageAction(type, session)
      if (type === 'export') {
        showSessionImageExportToast(request)
      } else {
        void request.promise.catch(() => toast.error(t('common.copy_failed')))
      }

      queueImageCaptureTarget(request, session)
    },
    [queueImageCaptureTarget, showSessionImageExportToast, t]
  )

  const handleSaveSessionToNotes = useCallback(
    async (session: AgentSessionEntity) => {
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportContentToNotes(title, markdown, notesPath)
    },
    [getSessionExportOptions, notesPath]
  )

  const handleSaveSessionToKnowledge = useCallback(
    async (session: AgentSessionEntity) => {
      try {
        const title = getAgentSessionExportTitle(session)
        const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
        const result = await SaveToKnowledgePopup.showForMessages(messages, title)
        if (result?.success) {
          toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
        }
      } catch (err) {
        logger.error('Failed to save agent session to knowledge base', { err, sessionId: session.id })
        toast.error(t('chat.save.topic.knowledge.error.save_failed'))
      }
    },
    [getSessionExportOptions, t]
  )

  const handleCopySessionMarkdown = useCallback(
    (session: AgentSessionEntity) => copyAgentSessionAsMarkdown(session, getSessionExportOptions(session)),
    [getSessionExportOptions]
  )

  const handleCopySessionPlainText = useCallback(
    (session: AgentSessionEntity) => copyAgentSessionAsPlainText(session, getSessionExportOptions(session)),
    [getSessionExportOptions]
  )

  const handleExportSessionMarkdown = useCallback(
    (session: AgentSessionEntity) => {
      return exportAgentSessionAsMarkdown(session, undefined, undefined, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionMarkdownReason = useCallback(
    (session: AgentSessionEntity) => {
      return exportAgentSessionAsMarkdown(session, true, undefined, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionWord = useCallback(
    async (session: AgentSessionEntity) => {
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await ipcApi.request('export.word.from_markdown', {
        markdown,
        fileName: removeSpecialCharactersForFileName(title)
      })
    },
    [getSessionExportOptions]
  )

  const handleExportSessionNotion = useCallback(
    async (session: AgentSessionEntity) => {
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await exportMessagesToNotion(title, messages)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionYuque = useCallback(
    async (session: AgentSessionEntity) => {
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportMarkdownToYuque(title, markdown)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionObsidian = useCallback(
    async (session: AgentSessionEntity) => {
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await ObsidianExportPopup.show({ title: title.replace(/\\/g, '_'), messages, processingMethod: '3' })
    },
    [getSessionExportOptions]
  )

  const handleExportSessionJoplin = useCallback(
    async (session: AgentSessionEntity) => {
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await exportMarkdownToJoplin(title, messages)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionSiyuan = useCallback(
    async (session: AgentSessionEntity) => {
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportMarkdownToSiyuan(title, markdown)
    },
    [getSessionExportOptions]
  )

  const handleCopySessionImage = useCallback(
    (session: AgentSessionEntity) => {
      handleSessionImageAction('copy', session)
    },
    [handleSessionImageAction]
  )

  const handleExportSessionImage = useCallback(
    (session: AgentSessionEntity) => {
      handleSessionImageAction('export', session)
    },
    [handleSessionImageAction]
  )

  const { trigger: findOrCreateWorkspace } = useMutation('POST', '/agent-workspaces', {
    refresh: ['/agent-workspaces']
  })
  const { trigger: updateWorkspace, isLoading: isUpdatingWorkspace } = useMutation(
    'PATCH',
    '/agent-workspaces/:workspaceId',
    {
      refresh: ['/agent-workspaces', '/agent-sessions']
    }
  )
  const { trigger: deleteWorkspace } = useMutation('DELETE', '/agent-workspaces/:workspaceId', {
    refresh: ['/agent-sessions', '/agent-sessions/stats', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const deleteAgent = useDeleteAgent()
  const { trigger: reorderWorkspace } = useMutation('PATCH', '/agent-workspaces/:id/order')
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })

  const createSessionFromDefaults = useCallback(
    async (defaults: SessionCreationDefaults | null | undefined) => {
      if (creatingSession) return null
      if (!defaults?.agentId) {
        const defaultAgent = agentsForDisplay[0]
        if (defaultAgent) {
          const createdSession = await onCreateSession?.({
            agentId: defaultAgent.id,
            workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
          })
          if (!createdSession) setActiveSessionId(null)
          return createdSession ?? null
        }

        await onShowMissingAgentSelection?.()
        return null
      }

      const agent = agentById.get(defaults.agentId)
      if (!agent) return null

      setCreatingSession(true)
      try {
        const workspace =
          defaults.workspace ??
          (defaults.workspacePath
            ? ({
                type: AGENT_WORKSPACE_TYPE.USER,
                workspaceId: (await findOrCreateWorkspace({ body: { path: defaults.workspacePath } })).id
              } satisfies AgentSessionWorkspaceSource)
            : ({ type: AGENT_WORKSPACE_TYPE.SYSTEM } satisfies AgentSessionWorkspaceSource))

        const createdSession = await onCreateSession?.({
          agentId: defaults.agentId,
          workspace
        })

        if (!createdSession) setActiveSessionId(null)
        return createdSession ?? null
      } catch (err) {
        logger.error('Failed to create session from session list', { err, agentId: defaults.agentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        return null
      } finally {
        setCreatingSession(false)
      }
    },
    [
      agentById,
      agentsForDisplay,
      creatingSession,
      findOrCreateWorkspace,
      onShowMissingAgentSelection,
      onCreateSession,
      setActiveSessionId,
      t
    ]
  )

  const handleHeaderCreateSession = useCallback(() => {
    void createSessionFromDefaults(headerSessionCreationDefaults)
  }, [createSessionFromDefaults, headerSessionCreationDefaults])

  const handleRetry = useCallback(async () => {
    await reloadSessionViews()
    if (displayMode === 'workdir') {
      await refetchWorkspaces()
    }
  }, [displayMode, refetchWorkspaces, reloadSessionViews])

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      if (deletingAgentId) return

      const currentActiveSessionId = activeSessionIdRef.current
      const currentActiveSession = currentActiveSessionId
        ? sessionItemsRef.current.find((session) => session.id === currentActiveSessionId)
        : undefined

      setDeletingAgentId(agentId)
      try {
        const confirmed = await popup.confirm({
          title: t('agent.delete.title'),
          content: t('agent.delete.content'),
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        const fallbackAgentIds = buildResourceOwnerFallbackIds(sessionOwnerFallbackAgentIds, agentId)
        const result = await deleteAgent({ params: { agentId }, query: { deleteSessions: true } })
        closeConversationTabs('agents', result.deletedSessionIds ?? [])
        if (currentActiveSession?.agentId === agentId) {
          if (onActiveAgentDeleted) {
            await onActiveAgentDeleted(agentId, fallbackAgentIds)
          } else {
            const remaining = sessionItemsRef.current.find((session) => session.agentId !== agentId)
            setActiveSessionId(remaining?.id ?? null)
          }
        }

        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete agent from session group', { agentId, err })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.delete.error.failed')))
      } finally {
        setDeletingAgentId(null)
      }
    },
    [
      closeConversationTabs,
      deleteAgent,
      deletingAgentId,
      onActiveAgentDeleted,
      sessionOwnerFallbackAgentIds,
      setActiveSessionId,
      t
    ]
  )

  const handleDeleteWorkdirGroup = useCallback(
    async (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId || deletingWorkspaceGroupId) return

      const sessionIds = sessionItems
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => session.id)
      if ((globalWorkdirSessionCountByGroupId.get(group.id) ?? 0) === 0) return

      const confirmed = await popup.confirm({
        title: t('agent.session.workdir.delete.title'),
        content: t('agent.session.workdir.delete.content'),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: {
          danger: true
        }
      })
      if (!confirmed) return

      setDeletingWorkspaceGroupId(group.id)

      try {
        const result = await deleteWorkspace({ params: { workspaceId } })
        closeConversationTabs('agents', result.deletedIds)
        const affectedSessionIds = new Set(result.deletedIds)

        if (activeSessionId && affectedSessionIds.has(activeSessionId)) {
          const remaining = sessionItems.find((session) => !affectedSessionIds.has(session.id))
          if (remaining) {
            setActiveSessionId(remaining.id)
          } else {
            const latest = await loadLatestSession()
            setControlledActiveSessionId(latest?.id ?? null, latest ?? null)
          }
        }

        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete workspace group', { err, sessionIds, workspaceId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.delete.error.failed')))
      } finally {
        setDeletingWorkspaceGroupId(null)
      }
    },
    [
      activeSessionId,
      closeConversationTabs,
      deleteWorkspace,
      deletingWorkspaceGroupId,
      globalWorkdirSessionCountByGroupId,
      loadLatestSession,
      sessionItems,
      setControlledActiveSessionId,
      setActiveSessionId,
      t,
      workdirDisplay
    ]
  )

  const handleStartRenameWorkdirGroup = useCallback(
    (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId) return

      setRenamingWorkspaceGroup({
        name: group.label,
        workspaceId
      })
    },
    [workdirDisplay]
  )

  const handleRenameWorkdirGroup = useCallback(
    async (name: string) => {
      const target = renamingWorkspaceGroup
      const trimmedName = name.trim()
      if (!target || !trimmedName || trimmedName === target.name.trim()) return

      try {
        await updateWorkspace({
          body: { name: trimmedName },
          params: { workspaceId: target.workspaceId }
        })
        toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename workspace group', { err, workspaceId: target.workspaceId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.rename.error.failed')))
      }
    },
    [renamingWorkspaceGroup, t, updateWorkspace]
  )

  const handleOpenWorkdirGroup = useCallback(
    async (workdirPath: string) => {
      try {
        await window.api.file.openPath(workdirPath)
      } catch (err) {
        toast.error(formatErrorMessageWithPrefix(err, t('files.error.open_path', { path: workdirPath })))
      }
    },
    [t]
  )

  const openAgentEditor = useCallback((agentId: string) => {
    setEditDialogTarget({ kind: 'agent', id: agentId })
  }, [])
  const openSessionInNewTab = useCallback(
    (session: AgentSessionEntity) => {
      conversationNav.openConversationTab(session.id, session.name || t('common.unnamed'), { forceNew: true })
    },
    [conversationNav, t]
  )
  const openSessionInNewWindow = useCallback(
    (session: AgentSessionEntity) => {
      conversationNav.openConversationWindow(session.id, session.name || t('common.unnamed'))
    },
    [conversationNav, t]
  )

  const handleToggleAgentPin = useCallback(
    async (agentId: string) => {
      if (isAgentPinActionDisabled) return

      try {
        await toggleAgentPin(agentId)
      } catch (err) {
        logger.error('Failed to toggle agent pin from session group', { agentId, err })
        toast.error(t('common.error'))
      }
    },
    [isAgentPinActionDisabled, t, toggleAgentPin]
  )

  const handleSelectSession = useCallback(
    (id: string | null) => {
      setActiveSessionId(id)
    },
    [setActiveSessionId]
  )
  const loadSessionGroup = useCallback(
    async (groupId: string) => {
      if (groupId === SESSION_PINNED_GROUP_ID) return pinnedSessions[0]?.id ?? null
      if (displayMode !== 'time') return loadSessionGroupWindow(groupId)

      return ordinarySessions[0]?.id ?? null
    },
    [ordinarySessions, displayMode, loadSessionGroupWindow, pinnedSessions]
  )
  const loadMoreSessionGroup = useCallback(
    async (groupId: string) => {
      if (anchoredSessionWindow?.groupId === groupId) {
        await loadMoreAnchoredSessionGroup(groupId)
        return
      }
      if (groupId === SESSION_PINNED_GROUP_ID) {
        if (pinnedSessionsSource.error) {
          await reloadPinnedSessions()
          return
        }
        loadMorePinnedSessions()
        return
      }
      if (displayMode !== 'time') {
        await loadMoreSessionGroupWindow(groupId)
        return
      }
      if (ordinarySessionsSource.error) {
        await reloadOrdinarySessions()
        return
      }
      loadMoreOrdinarySessions()
    },
    [
      anchoredSessionWindow?.groupId,
      ordinarySessionsSource.error,
      displayMode,
      loadMoreAnchoredSessionGroup,
      loadMoreOrdinarySessions,
      loadMorePinnedSessions,
      loadMoreSessionGroupWindow,
      pinnedSessionsSource.error,
      reloadPinnedSessions,
      reloadOrdinarySessions
    ]
  )
  const revealSession = useCallback(
    async (request: ResourceListRevealRequest) => {
      type WindowScope = { agentId?: string; workspaceId?: string }
      const fetchWindow = (q: string | undefined, scope: WindowScope = {}) =>
        dataApiService.get('/agent-sessions/window', {
          query: {
            anchorId: request.itemId,
            limit: SESSION_PAGE_SIZE,
            sortBy: sessionSortBy,
            ...(q ? { q, searchScope: 'name' as const } : {}),
            ...scope
          }
        })

      let resolvedQuery = debouncedRemoteQuery || undefined
      const initialScope: WindowScope = rightPanelAgentScope ? { agentId: rightPanelAgentScope } : {}
      let result = await fetchWindow(resolvedQuery, initialScope)
      if (result.status === 'ANCHOR_OUTSIDE_QUERY' && resolvedQuery) {
        if (!request.clearQuery) {
          setModeRevealRequest((current) =>
            current?.request?.requestId === request.requestId ? { ...current, request: undefined } : current
          )
          return true
        }
        setRemoteQuery('')
        resolvedQuery = undefined
        result = await fetchWindow(undefined, initialScope)
      }
      if (result.status !== 'FOUND') return false

      let groupId = result.band === 'pinned' ? SESSION_PINNED_GROUP_ID : SESSION_ORDINARY_GROUP_ID
      if (result.band === 'ordinary' && displayMode !== 'time' && !rightPanelAgentScope) {
        const anchor = result.items[result.anchorIndex]
        groupId = getSessionDisplayGroupId(anchor)

        let groupScope: WindowScope
        if (displayMode === 'agent') {
          groupScope = { agentId: anchor.agentId && agentById.has(anchor.agentId) ? anchor.agentId : 'unlinked' }
        } else {
          const workspaceId =
            groupId === SESSION_SYSTEM_WORKSPACE_GROUP_ID || groupId === SESSION_NO_WORKDIR_GROUP_ID
              ? 'system'
              : (workdirDisplay.workspaceIdByGroupId.get(groupId) ?? getWorkspaceIdFromSessionGroupId(groupId))
          if (!workspaceId) return false
          groupScope = { workspaceId }
        }

        result = await fetchWindow(resolvedQuery, groupScope)
        if (result.status !== 'FOUND') return false
      }

      replaceAnchoredSessionWindow({
        anchorId: request.itemId,
        band: result.band,
        groupId,
        items: result.items,
        previousCursor: result.previousCursor,
        nextCursor: result.nextCursor
      })
      return true
    },
    [
      agentById,
      debouncedRemoteQuery,
      displayMode,
      getSessionDisplayGroupId,
      replaceAnchoredSessionWindow,
      rightPanelAgentScope,
      sessionSortBy,
      workdirDisplay.workspaceIdByGroupId
    ]
  )
  const handleSessionRevealError = useCallback(
    (failure: ResourceListRemoteRevealFailure, request: ResourceListRevealRequest) => {
      if (failure.kind === 'not-found') {
        toast.error(t('agent.session.get.error.not_found'))
        return
      }
      logger.error('Failed to reveal agent session', { err: failure.error, sessionId: request.itemId })
      toast.error(formatErrorMessageWithPrefix(failure.error, t('common.error')))
    },
    [t]
  )
  const sessionListRemoteData = useMemo<ResourceListRemoteData>(
    () => ({
      groupStates: sessionGroupStates,
      loadGroup: loadSessionGroup,
      loadMoreGroup: loadMoreSessionGroup,
      loadPreviousGroup: loadPreviousAnchoredSessionGroup,
      onRevealError: handleSessionRevealError,
      onQueryChange: setRemoteQuery,
      query: remoteQuery,
      revealItem: revealSession
    }),
    [
      handleSessionRevealError,
      loadMoreSessionGroup,
      loadPreviousAnchoredSessionGroup,
      loadSessionGroup,
      remoteQuery,
      revealSession,
      sessionGroupStates
    ]
  )
  const isSessionItemGroupStable = useCallback(
    (groupId: string) =>
      sessionGroupStates[groupId]?.status === 'idle' &&
      !(anchoredSessionWindow?.groupId === groupId && isAnchoredSessionWindowLoading),
    [anchoredSessionWindow?.groupId, isAnchoredSessionWindowLoading, sessionGroupStates]
  )
  const canDragSessionItem = useCallback(
    ({ item, group }: { item: SessionListItem; group: ResourceListGroup }) =>
      itemDragReady && !item.pinned && isSessionItemGroupStable(group.id),
    [isSessionItemGroupStable, itemDragReady]
  )

  const canDropSessionItem = useCallback(
    ({
      overItem,
      overType,
      sourceGroupId,
      targetGroupId
    }: {
      overItem?: SessionListItem
      overType: 'group' | 'item'
      sourceGroupId: string
      targetGroupId: string
    }) =>
      itemDragReady &&
      overType === 'item' &&
      !!overItem &&
      isSessionItemGroupStable(sourceGroupId) &&
      isSessionItemGroupStable(targetGroupId) &&
      canDropSessionItemInDisplayGroup({ mode: displayMode, sourceGroupId, targetGroupId }),
    [displayMode, isSessionItemGroupStable, itemDragReady]
  )

  const canDragSessionGroup = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        return agentDragReady && !!agentId && agentById.has(agentId)
      }

      return (
        workdirDragReady && (!!getWorkdirSectionFromId(group.id) || workdirDisplay.workspaceIdByGroupId.has(group.id))
      )
    },
    [agentById, agentDragReady, displayMode, workdirDragReady, workdirDisplay]
  )

  const canDropSessionGroup = useCallback(
    ({ activeGroupId, overGroupId }: { activeGroupId: string; overGroupId: string }) => {
      if (displayMode === 'agent') {
        const activeAgentId = getAgentIdFromSessionGroupId(activeGroupId)
        const overAgentId = getAgentIdFromSessionGroupId(overGroupId)

        return (
          agentDragReady &&
          !!activeAgentId &&
          !!overAgentId &&
          activeAgentId !== overAgentId &&
          agentById.has(activeAgentId) &&
          agentById.has(overAgentId)
        )
      }

      const activeSection = getWorkdirSectionFromId(activeGroupId)
      const overSection = getWorkdirSectionFromId(overGroupId)
      if (activeSection || overSection) {
        return workdirDragReady && !!activeSection && !!overSection && activeSection !== overSection
      }

      const activeWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(activeGroupId)
      const overWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(overGroupId)

      return workdirDragReady && !!activeWorkspaceId && !!overWorkspaceId && activeWorkspaceId !== overWorkspaceId
    },
    [agentById, agentDragReady, displayMode, workdirDragReady, workdirDisplay]
  )

  const handleSessionReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (payload.type === 'group') {
        if (displayMode === 'agent') {
          if (!agentDragReady) return

          const activeAgentId = getAgentIdFromSessionGroupId(payload.activeGroupId)
          const overAgentId = getAgentIdFromSessionGroupId(payload.overGroupId)

          if (
            !activeAgentId ||
            !overAgentId ||
            activeAgentId === overAgentId ||
            !agentById.has(activeAgentId) ||
            !agentById.has(overAgentId)
          ) {
            return
          }

          const agentIds = agentsForDisplay.map((agent) => agent.id)
          const nextAgentIds = moveSessionAgentGroupAfterDrop(agentIds, activeAgentId, overAgentId, payload)
          const anchor = buildSessionAgentGroupDropAnchor(payload, overAgentId)

          setOptimisticAgentOrderIds(nextAgentIds)

          try {
            await reorderAgent({ params: { id: activeAgentId }, body: anchor })
            setOptimisticAgentOrderIds(null)
          } catch (err) {
            setOptimisticAgentOrderIds(null)
            logger.error('Failed to reorder agent session group', { activeAgentId, err, overAgentId })
            toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))

            try {
              await refetchAgents()
            } catch (refreshErr) {
              logger.error('Failed to refresh agents after group reorder failure', {
                activeAgentId,
                refreshErr
              })
            }
          }

          return
        }

        if (!workdirDragReady) return

        const activeSection = getWorkdirSectionFromId(payload.activeGroupId)
        const overSection = getWorkdirSectionFromId(payload.overGroupId)
        if (activeSection || overSection) {
          if (!activeSection || !overSection || activeSection === overSection) return
          const nextSectionOrder = [...workdirSectionOrder]
          const activeIndex = nextSectionOrder.indexOf(activeSection)
          const overIndex = nextSectionOrder.indexOf(overSection)
          if (activeIndex < 0 || overIndex < 0) return
          const activeValue = nextSectionOrder[activeIndex]
          nextSectionOrder[activeIndex] = nextSectionOrder[overIndex]!
          nextSectionOrder[overIndex] = activeValue
          try {
            await setStoredWorkdirSectionOrder(nextSectionOrder)
          } catch (err) {
            logger.error('Failed to reorder workdir sections', { err })
            toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))
          }
          return
        }

        const activeWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(payload.activeGroupId)
        const overWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(payload.overGroupId)

        if (!activeWorkspaceId || !overWorkspaceId || activeWorkspaceId === overWorkspaceId) return

        const nextWorkspaceRows = moveSessionWorkdirGroupAfterDrop(
          workspaceRowsForDisplay,
          activeWorkspaceId,
          overWorkspaceId,
          payload
        )
        const anchor = buildSessionWorkdirGroupDropAnchor(payload, overWorkspaceId)

        setOptimisticWorkspaceOrderIds(nextWorkspaceRows.map((workspace) => workspace.id))

        try {
          await reorderWorkspace({ params: { id: activeWorkspaceId }, body: anchor })
          await refetchWorkspaces()
          setOptimisticWorkspaceOrderIds(null)
        } catch (err) {
          setOptimisticWorkspaceOrderIds(null)
          logger.error('Failed to reorder workspace group', {
            activeWorkspaceId,
            err,
            overWorkspaceId
          })
          toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))

          try {
            await refetchWorkspaces()
          } catch (refreshErr) {
            logger.error('Failed to refresh workspaces after group reorder failure', {
              activeWorkspaceId,
              refreshErr
            })
          }
        }

        return
      }

      if (
        !itemDragReady ||
        !isSessionItemGroupStable(payload.sourceGroupId) ||
        !isSessionItemGroupStable(payload.targetGroupId)
      ) {
        return
      }
      if (
        !canDropSessionItemInDisplayGroup({
          mode: displayMode,
          sourceGroupId: payload.sourceGroupId,
          targetGroupId: payload.targetGroupId
        })
      ) {
        return
      }

      const session = sessionItems.find((candidate) => candidate.id === payload.activeId)
      if (!session || session.pinned) return

      const normalizedPayload = normalizeSessionDropPayload(payload)
      const anchor = buildSessionDropAnchor(normalizedPayload)
      if (!anchor) return
      setOptimisticMove(normalizedPayload)

      const reordered = await reorderSession(payload.activeId, anchor)
      if (!reordered) {
        setOptimisticMove(null)
      }
    },
    [
      displayMode,
      agentById,
      agentDragReady,
      agentsForDisplay,
      itemDragReady,
      isSessionItemGroupStable,
      refetchAgents,
      refetchWorkspaces,
      reorderAgent,
      reorderSession,
      reorderWorkspace,
      sessionItems,
      t,
      setStoredWorkdirSectionOrder,
      workdirDragReady,
      workdirDisplay,
      workdirSectionOrder,
      workspaceRowsForDisplay
    ]
  )

  const getGroupHeaderAction = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null
      if (displayMode === 'time') return null

      const agentGroupId = displayMode === 'agent' ? getAgentIdFromSessionGroupId(group.id) : undefined
      const workspaceId = displayMode === 'workdir' ? workdirDisplay.workspaceIdByGroupId.get(group.id) : undefined
      const workdirPath =
        displayMode === 'workdir'
          ? (workdirDisplay.pathByGroupId.get(group.id) ?? getWorkdirPathFromSessionGroupId(group.id))
          : undefined
      const sessionCreationDefaults = getSessionCreationDefaultsForGroup(group.id)
      const canCreateSession =
        (sessionCreationDefaults !== null && agentById.has(sessionCreationDefaults.agentId)) ||
        (displayMode === 'workdir' && (workdirSessionStatsByGroupId.get(group.id)?.count ?? 0) > 0)
      const canManageAgentGroup = !!agentGroupId && agentById.has(agentGroupId)

      if (!canCreateSession && !workdirPath && !canManageAgentGroup) return null

      return (
        <>
          {canManageAgentGroup && agentGroupId && (
            <Tooltip title={t('common.more')} delay={500}>
              <AgentGroupMoreMenu
                agentId={agentGroupId}
                assistantIconType={assistantIconType}
                deleteAgentDisabled={deletingAgentId !== null}
                pinDisabled={isAgentPinActionDisabled}
                pinned={agentPinnedIdSet.has(agentGroupId)}
                onDeleteAgent={handleDeleteAgent}
                onEdit={openAgentEditor}
                onSetAgentIconType={setAssistantIconType}
                onTogglePin={handleToggleAgentPin}
              />
            </Tooltip>
          )}
          {workdirPath && (
            <Tooltip title={t('common.more')} delay={500}>
              <WorkdirGroupMoreMenu
                canDelete={!!workspaceId}
                canRename={!!workspaceId}
                deleteDisabled={!!deletingWorkspaceGroupId}
                group={group}
                renameDisabled={isUpdatingWorkspace}
                workdirPath={workdirPath}
                onDelete={handleDeleteWorkdirGroup}
                onOpen={handleOpenWorkdirGroup}
                onRename={handleStartRenameWorkdirGroup}
              />
            </Tooltip>
          )}
          {canCreateSession && (
            <Tooltip title={t('agent.session.new')} delay={500}>
              <ResourceList.GroupHeaderActionButton
                type="button"
                aria-label={t('agent.session.new')}
                disabled={creatingSession}
                onClick={(event) => {
                  event.stopPropagation()
                  void resolveSessionCreationDefaultsForGroup(group.id).then(createSessionFromDefaults)
                }}>
                <SquarePen className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )}
        </>
      )
    },
    [
      agentById,
      agentPinnedIdSet,
      assistantIconType,
      createSessionFromDefaults,
      creatingSession,
      deletingAgentId,
      deletingWorkspaceGroupId,
      displayMode,
      getSessionCreationDefaultsForGroup,
      handleDeleteAgent,
      handleToggleAgentPin,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      resolveSessionCreationDefaultsForGroup,
      setAssistantIconType,
      t,
      workdirDisplay,
      workdirSessionStatsByGroupId
    ]
  )

  const getSectionHeaderAction = useCallback(
    (section: ResourceListSection) => {
      if (section.id !== SESSION_SYSTEM_WORKSPACE_SECTION_ID) return null

      const sessionCreationDefaults = findLatestSessionCreationDefaults(
        filteredGroupedSessions,
        isSystemWorkspaceSession
      )
      const canCreateSession =
        (sessionCreationDefaults !== null && agentById.has(sessionCreationDefaults.agentId)) ||
        (workdirSessionStatsByGroupId.get(SESSION_SYSTEM_WORKSPACE_GROUP_ID)?.count ?? 0) > 0
      if (!canCreateSession) return null

      return (
        <Tooltip title={t('agent.session.new')} delay={500}>
          <ResourceList.GroupHeaderActionButton
            type="button"
            aria-label={t('agent.session.new')}
            disabled={creatingSession}
            onClick={(event) => {
              event.stopPropagation()
              void resolveSessionCreationDefaultsForGroup(SESSION_SYSTEM_WORKSPACE_GROUP_ID).then(
                createSessionFromDefaults
              )
            }}>
            <SquarePen className="block" />
          </ResourceList.GroupHeaderActionButton>
        </Tooltip>
      )
    },
    [
      agentById,
      createSessionFromDefaults,
      creatingSession,
      filteredGroupedSessions,
      resolveSessionCreationDefaultsForGroup,
      t,
      workdirSessionStatsByGroupId
    ]
  )

  const getGroupHeaderIcon = useCallback(
    (group: ResourceListGroup, context: { collapsed: boolean }) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return undefined

      if (displayMode === 'workdir') {
        if (group.id === SESSION_NO_WORKDIR_GROUP_ID || group.id === SESSION_SYSTEM_WORKSPACE_GROUP_ID) return null
        if (!context.collapsed) return <FolderOpen size={13} />

        return (
          <span className="flex size-4 items-center justify-center text-foreground/70 group-focus-within/resource-list-group:text-foreground group-hover/resource-list-group:text-foreground">
            <Folder size={13} className="block group-hover/resource-list-group:hidden" />
            <FolderOpen size={13} className="hidden group-hover/resource-list-group:block" />
          </span>
        )
      }

      if (displayMode !== 'agent') return undefined
      if (group.id === SESSION_UNLINKED_AGENT_GROUP_ID) return null

      const agentId = getAgentIdFromSessionGroupId(group.id)
      const agent = agentId ? agentById.get(agentId) : undefined
      return renderAgentEntityIcon(assistantIconType, agent, defaultModelId)
    },
    [agentById, assistantIconType, defaultModelId, displayMode]
  )

  const getGroupHeaderClassName = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode !== 'agent' || group.id === SESSION_PINNED_GROUP_ID) return undefined

      const agentId = getAgentIdFromSessionGroupId(group.id)
      if (!agentId || !agentById.has(agentId)) return undefined

      return 'rounded-lg border border-transparent'
    },
    [agentById, displayMode]
  )

  const getGroupHeaderTooltip = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode !== 'agent' || group.id === SESSION_PINNED_GROUP_ID) return undefined

      const agentId = getAgentIdFromSessionGroupId(group.id)
      if (!agentId || !agentById.has(agentId)) return undefined

      return t('agent.session.group.drag_hint')
    },
    [agentById, displayMode, t]
  )

  const getGroupHeaderContextMenu = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null

      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        if (!agentId || !agentById.has(agentId)) return null

        const actionContext: AgentGroupActionContext = {
          agentId,
          assistantIconType,
          deleteAgentDisabled: deletingAgentId !== null,
          onDeleteAgent: handleDeleteAgent,
          onEdit: openAgentEditor,
          onSetAgentIconType: setAssistantIconType,
          onTogglePin: handleToggleAgentPin,
          pinDisabled: isAgentPinActionDisabled,
          pinned: agentPinnedIdSet.has(agentId),
          t
        }
        const actions = resolveAgentGroupActions(actionContext)

        return actionsToCommandMenuExtraItems(actions, (action) => {
          void executeAgentGroupAction(action, actionContext)
        })
      }

      if (displayMode !== 'workdir') return null

      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      const workdirPath = workdirDisplay.pathByGroupId.get(group.id) ?? getWorkdirPathFromSessionGroupId(group.id)
      if (!workdirPath) return null
      const actionContext: WorkdirGroupActionContext = {
        canDelete: !!workspaceId,
        canRename: !!workspaceId,
        deleteDisabled: !!deletingWorkspaceGroupId,
        group,
        onDelete: handleDeleteWorkdirGroup,
        onOpen: handleOpenWorkdirGroup,
        onRename: handleStartRenameWorkdirGroup,
        renameDisabled: isUpdatingWorkspace,
        t,
        workdirPath
      }
      const actions = resolveWorkdirGroupActions(actionContext)

      return actionsToCommandMenuExtraItems(actions, (action) => {
        void executeWorkdirGroupAction(action, actionContext)
      })
    },
    [
      agentById,
      agentPinnedIdSet,
      assistantIconType,
      deletingAgentId,
      deletingWorkspaceGroupId,
      displayMode,
      handleDeleteAgent,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      handleToggleAgentPin,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      setAssistantIconType,
      t,
      workdirDisplay
    ]
  )

  const sessionMenuActions = useMemo<SessionItemMenuActions>(
    () => ({
      exportMenuOptions: exportMenuOptions as SessionItemMenuActions['exportMenuOptions'],
      onAutoRename: handleAutoRenameSession,
      onCopyImage: handleCopySessionImage,
      onCopyMarkdown: handleCopySessionMarkdown,
      onCopyPlainText: handleCopySessionPlainText,
      onExportImage: handleExportSessionImage,
      onExportJoplin: handleExportSessionJoplin,
      onExportMarkdown: handleExportSessionMarkdown,
      onExportMarkdownReason: handleExportSessionMarkdownReason,
      onExportNotion: handleExportSessionNotion,
      onExportObsidian: handleExportSessionObsidian,
      onExportSiyuan: handleExportSessionSiyuan,
      onExportWord: handleExportSessionWord,
      onExportYuque: handleExportSessionYuque,
      onSaveToKnowledge: handleSaveSessionToKnowledge,
      onSaveToNotes: handleSaveSessionToNotes
    }),
    [
      exportMenuOptions,
      handleAutoRenameSession,
      handleCopySessionMarkdown,
      handleCopySessionPlainText,
      handleCopySessionImage,
      handleExportSessionImage,
      handleExportSessionJoplin,
      handleExportSessionMarkdown,
      handleExportSessionMarkdownReason,
      handleExportSessionNotion,
      handleExportSessionObsidian,
      handleExportSessionSiyuan,
      handleExportSessionWord,
      handleExportSessionYuque,
      handleSaveSessionToKnowledge,
      handleSaveSessionToNotes
    ]
  )

  // Pinned/created/group-window failures remain recoverable inside their remote group. Only
  // metadata failures that prevent group construction should replace the whole list.
  const listError =
    sessionStatsError ??
    (displayMode === 'agent' ? agentsError : displayMode === 'workdir' ? workspacesError : undefined)
  const listLoading =
    sessionItems.length === 0 &&
    (isSessionStatsLoading ||
      pinnedSessionsSource.isLoading ||
      (displayMode === 'time'
        ? isOrdinarySessionsLoading
        : displayMode === 'agent'
          ? isAgentsLoading
          : isWorkdirMetadataLoading))
  const listValidating =
    pinnedSessionsSource.isValidating ||
    (displayMode === 'time' ? isOrdinarySessionsValidating : isWorkdirMetadataRefreshing)
  const visibleGroupedSessions = filteredGroupedSessions
  const listStatus =
    listError && sessionItems.length === 0
      ? 'error'
      : listLoading
        ? 'loading'
        : sessionGroupSeeds.length === 0 && (sessionStats?.total ?? sessionItems.length) === 0
          ? 'empty'
          : 'idle'
  const handleSessionEndReached = useCallback(() => {
    if (
      displayMode === 'time' &&
      !ordinarySessionsSource.error &&
      hasMoreOrdinarySessions &&
      !isOrdinarySessionsValidating
    ) {
      loadMoreOrdinarySessions()
    }
  }, [
    ordinarySessionsSource.error,
    displayMode,
    hasMoreOrdinarySessions,
    isOrdinarySessionsValidating,
    loadMoreOrdinarySessions
  ])
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const hasActiveCenterSurface = hasActiveResourceMenuItem || historyRecordsActive
  const activeSessionAgentId =
    activeSession?.agentId ?? sessionItems.find((session) => session.id === activeSessionId)?.agentId
  const getSessionGroupHeaderClickBehavior = useCallback(
    (group: ResourceListGroup) => {
      const agentId = getAgentIdFromSessionGroupId(group.id)
      return displayMode === 'agent' && agentId && agentById.has(agentId) ? 'select-first-then-toggle' : 'toggle'
    },
    [agentById, displayMode]
  )
  const getSessionGroupHeaderSelected = useCallback(
    (group: ResourceListGroup) => {
      if (hasActiveCenterSurface) return false
      const agentId = getAgentIdFromSessionGroupId(group.id)
      return !!agentId && activeSessionAgentId === agentId
    },
    [activeSessionAgentId, hasActiveCenterSurface]
  )
  const handleActivateAgentGroup = useCallback(
    async (group: ResourceListGroup) => {
      const agentId = getAgentIdFromSessionGroupId(group.id)
      if (!agentId || !agentById.has(agentId)) return false

      try {
        await activateOwnerResource(agentId)
      } catch (err) {
        logger.error('Failed to activate agent session group', { agentId, err })
        toast.error(t('common.error'))
      }

      return true
    },
    [activateOwnerResource, agentById, t]
  )
  const manageAgentsMenuItem = resourceMenuItems?.find((item) => item.id === 'agent-resource-view')
  const manageSkillsMenuItem = resourceMenuItems?.find((item) => item.id === 'skill-resource-view')
  const headerCreateLabel = displayMode === 'agent' ? t('agent.add.title') : t('agent.session.new')
  const headerCreateDisabled =
    displayMode === 'agent'
      ? !onAddAgent
      : creatingSession || (!headerSessionCreationDefaults && !onShowMissingAgentSelection)
  const handleHeaderCreate = displayMode === 'agent' ? () => void onAddAgent?.() : handleHeaderCreateSession
  const canSetPanePosition = displayMode === 'agent' || isRightPanel

  return (
    <SessionResourceList<SessionListItem>
      key={isRightPanel ? `session-resource-panel:${agentIdFilter ?? 'blank'}` : 'session-resource-sidebar'}
      className={cn(isRightPanel && 'h-full min-h-0 border-r-0')}
      items={visibleGroupedSessions}
      status={listStatus}
      groupSeeds={sessionGroupSeeds}
      remoteData={sessionListRemoteData}
      selectedId={hasActiveCenterSurface ? null : activeSessionId}
      groupBy={sessionGroupBy}
      sectionBy={sessionSectionBy}
      collapsedState={collapsedSessionState}
      revealRequest={effectiveRevealRequest}
      defaultGroupVisibleCount={defaultGroupVisibleCount}
      groupLoadStep={displayMode === 'time' ? Number.POSITIVE_INFINITY : DEFAULT_SESSION_GROUP_VISIBLE_COUNT}
      getSectionHeaderAction={getSectionHeaderAction}
      getGroupHeaderAction={getGroupHeaderAction}
      getGroupHeaderClassName={getGroupHeaderClassName}
      getGroupHeaderContextMenu={getGroupHeaderContextMenu}
      getGroupHeaderIcon={getGroupHeaderIcon}
      getGroupHeaderTooltip={getGroupHeaderTooltip}
      groupHeaderClickBehavior={getSessionGroupHeaderClickBehavior}
      getGroupHeaderSelected={getSessionGroupHeaderSelected}
      onGroupHeaderActivate={handleActivateAgentGroup}
      dragCapabilities={{
        groups: groupDragReady,
        items: itemDragReady,
        itemSameGroup: itemDragReady,
        itemCrossGroup: false
      }}
      canDragGroup={canDragSessionGroup}
      canDropGroup={canDropSessionGroup}
      canDragItem={canDragSessionItem}
      canDropItem={canDropSessionItem}
      groupShowMoreLabel={t('agent.session.group.show_more')}
      groupCollapseLabel={t('agent.session.group.collapse')}
      onRenameItem={handleRenameSession}
      onReorder={handleSessionReorder}
      onCollapsedStateChange={displayMode === 'time' ? undefined : handleSessionCollapsedStateChange}>
      <ResourceList.Header className={cn('gap-1', isRightPanel && 'pb-1')}>
        {isRightPanel ? (
          <ResourceList.Search
            aria-label={t('agent.session.search.title')}
            className={RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS}
            placeholder={t('agent.session.search.placeholder')}
            wrapperClassName="pt-1"
          />
        ) : (
          <>
            <ResourceList.HeaderItem
              type="button"
              command={displayMode === 'agent' ? undefined : 'topic.create'}
              aria-label={headerCreateLabel}
              disabled={headerCreateDisabled}
              icon={displayMode === 'agent' ? <Plus /> : <SquarePen />}
              label={headerCreateLabel}
              onClick={handleHeaderCreate}
              actions={
                <SessionListOptionsMenu
                  historyRecordsActive={historyRecordsActive}
                  manageAgentsActive={manageAgentsMenuItem?.active}
                  manageSkillsActive={manageSkillsMenuItem?.active}
                  manageSkillsIcon={manageSkillsMenuItem?.icon}
                  mode={displayMode}
                  onChange={(nextMode) => void setSessionDisplayMode(nextMode)}
                  onManageAgents={manageAgentsMenuItem?.onSelect}
                  onManageSkills={manageSkillsMenuItem?.onSelect}
                  onOpenHistoryRecords={onOpenHistoryRecords}
                  onSortByChange={(nextSortBy) => void setSessionSortBy(nextSortBy)}
                  sectionId={
                    displayMode === 'agent'
                      ? SESSION_AGENT_SECTION_ID
                      : displayMode === 'workdir'
                        ? SESSION_WORKDIR_SECTION_ID
                        : undefined
                  }
                  sortBy={sessionSortBy}
                />
              }
            />
          </>
        )}
      </ResourceList.Header>
      <SessionListBody
        activeSessionId={activeSessionId}
        channelTypeMap={channelTypeMap}
        displayMode={displayMode}
        error={listError}
        isDraggable={!isRightPanel && (groupDragReady || itemDragReady)}
        isRightPanel={isRightPanel}
        isValidating={listValidating}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onEndReached={displayMode === 'time' ? handleSessionEndReached : undefined}
        onOpenInNewTab={isWindowFrame ? undefined : openSessionInNewTab}
        onOpenInNewWindow={openSessionInNewWindow}
        onRetry={handleRetry}
        onSetPanePosition={canSetPanePosition ? setResolvedPanePosition : undefined}
        onTogglePin={toggleSessionPin}
        panePosition={canSetPanePosition ? resolvedPanePosition : undefined}
        sessionMenuActions={sessionMenuActions}
        setActiveSessionId={handleSelectSession}
      />
      <EditNameDialog
        open={!!renamingWorkspaceGroup}
        title={t('agent.session.workdir.rename.title')}
        initialName={renamingWorkspaceGroup?.name ?? ''}
        onSubmit={handleRenameWorkdirGroup}
        onOpenChange={(open) => {
          if (!open) setRenamingWorkspaceGroup(null)
        }}
      />
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
        onSaved={refetchAgents}
      />
      {imageCaptureTargets.map(({ requestId, target: session }) => {
        const activeAgent = session.agentId ? agentById.get(session.agentId) : undefined
        return (
          <AgentSessionImageCaptureHost
            key={requestId}
            activeAgent={activeAgent}
            modelFallback={getAgentModelFallbackSnapshot(activeAgent)}
            session={session}
          />
        )
      })}
    </SessionResourceList>
  )
}

interface SessionListBodyProps {
  activeSessionId: string | null
  channelTypeMap: Record<string, string>
  displayMode: AgentSessionDisplayMode
  error?: unknown
  isDraggable: boolean
  isRightPanel: boolean
  isValidating: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDeleteSession: (id: string) => Promise<void>
  onEndReached?: () => void
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onOpenInNewWindow?: (session: AgentSessionEntity) => void
  onRetry: () => Promise<unknown>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onTogglePin: (id: string) => void | Promise<unknown>
  panePosition?: TopicTabPosition
  sessionMenuActions: SessionItemMenuActions
  setActiveSessionId: (id: string | null) => void
}

function SessionListBody({
  activeSessionId,
  channelTypeMap,
  displayMode,
  error,
  isDraggable,
  isRightPanel,
  isValidating,
  listRef,
  onDeleteSession,
  onEndReached,
  onOpenInNewTab,
  onOpenInNewWindow,
  onRetry,
  onSetPanePosition,
  onTogglePin,
  panePosition,
  sessionMenuActions,
  setActiveSessionId
}: SessionListBodyProps) {
  const { t } = useTranslation()

  const renderItem = useCallback(
    (session: SessionListItem) => (
      <SessionItem
        key={session.id}
        session={session}
        active={session.id === activeSessionId}
        channelType={channelTypeMap[session.id]}
        pinned={session.pinned}
        reserveLeadingIconSlot={
          displayMode !== 'time' && !(displayMode === 'workdir' && isSystemWorkspaceSession(session))
        }
        onTogglePin={onTogglePin}
        onDelete={onDeleteSession}
        onOpenInNewTab={onOpenInNewTab}
        onOpenInNewWindow={onOpenInNewWindow}
        onSetPanePosition={onSetPanePosition}
        panePosition={panePosition}
        onPress={setActiveSessionId}
        sessionMenuActions={sessionMenuActions}
      />
    ),
    [
      activeSessionId,
      channelTypeMap,
      displayMode,
      onDeleteSession,
      onOpenInNewTab,
      onOpenInNewWindow,
      onSetPanePosition,
      onTogglePin,
      panePosition,
      sessionMenuActions,
      setActiveSessionId
    ]
  )

  return (
    <ResourceList.Body<SessionListItem>
      listRef={listRef}
      draggable={isDraggable}
      onEndReached={onEndReached}
      virtualClassName={cn('pt-0', isRightPanel ? 'pb-8' : 'pb-3')}
      errorFallback={
        <ResourceList.ErrorState>
          <div className="flex flex-col gap-2">
            <div className="font-medium text-destructive">{t('agent.session.get.error.failed')}</div>
            <div className="text-muted-foreground">{formatErrorMessage(error)}</div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => void onRetry()}
              disabled={isValidating}>
              {t('common.retry')}
            </Button>
          </div>
        </ResourceList.ErrorState>
      }
      emptyFallback={
        <div className="mx-auto flex h-full w-full max-w-sm items-center justify-center break-words px-5 py-10 text-center text-muted-foreground text-xs">
          {t('agent.session.empty.title')}
        </div>
      }
      renderItem={renderItem}
    />
  )
}

export default memo(Sessions)
