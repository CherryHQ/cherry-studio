import {
  Button,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import {
  remapResourceListCollapsedGroupIds,
  ResourceList,
  type ResourceListGroup,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  SessionResourceList
} from '@renderer/components/chat/resources'
import { CommandPopupMenu } from '@renderer/components/command'
import EditNameDialog from '@renderer/components/EditNameDialog'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ResourceEditDialogHost, type ResourceEditDialogTarget } from '@renderer/components/resource/dialogs'
import { useCurrentTabId } from '@renderer/context/TabIdContext'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useSessions, useUpdateSession } from '@renderer/hooks/agents/useSession'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { usePins } from '@renderer/hooks/usePins'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentSessionWorkspaceSource,
  type AgentWorkspaceEntity
} from '@shared/data/api/schemas/agentWorkspaces'
import {
  Bot,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Folder,
  FolderOpen,
  ListFilter,
  MoreHorizontal,
  PanelLeft,
  SquarePen
} from 'lucide-react'
import { memo, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DraftAgentSessionDefaults } from '../types'
import { type AgentGroupActionContext, executeAgentGroupAction, resolveAgentGroupActions } from './agentGroupActions'
import SessionItem from './SessionItem'
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
  getWorkdirPathFromSessionGroupId,
  isSystemWorkspaceSession,
  moveSessionAgentGroupAfterDrop,
  moveSessionWorkdirGroupAfterDrop,
  normalizeSessionDropPayload,
  SESSION_AGENT_SECTION_ID,
  SESSION_NO_PROJECT_GROUP_ID,
  SESSION_NO_PROJECT_SECTION_ID,
  SESSION_NO_WORKDIR_GROUP_ID,
  SESSION_PINNED_GROUP_ID,
  SESSION_PINNED_SECTION_ID,
  SESSION_UNKNOWN_AGENT_GROUP_ID,
  SESSION_WORKDIR_SECTION_ID,
  type SessionListItem,
  sortSessionsForDisplayGroups
} from './sessionListHelpers'
import {
  executeWorkdirGroupAction,
  resolveWorkdirGroupActions,
  type WorkdirGroupActionContext
} from './workdirGroupActions'

type SessionsBaseProps = {
  onSelectItem?: () => void
  onStartDraftSession?: (defaults: DraftAgentSessionDefaults) => void | Promise<void>
  onStartMissingAgentDraft?: () => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
}

type ControlledSessionsProps = SessionsBaseProps & {
  activeSessionId: string | null
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

type SessionsProps = ControlledSessionsProps

const logger = loggerService.withContext('AgentSessions')

const SESSION_DISPLAY_OPTIONS: AgentSessionDisplayMode[] = ['time', 'agent', 'workdir']
const SESSION_DISPLAY_LABEL_KEYS: Record<AgentSessionDisplayMode, string> = {
  agent: 'agent.session.display.agent',
  time: 'agent.session.display.time',
  workdir: 'agent.session.display.workdir'
}
const SESSION_DISPLAY_ICONS: Record<AgentSessionDisplayMode, ReactNode> = {
  agent: <Bot size={16} />,
  time: <Clock size={16} />,
  workdir: <Folder size={16} />
}
const EMPTY_WORKSPACE_ROWS: AgentWorkspaceEntity[] = []
type CreateSessionSeed = {
  agentId: string
  workspace?: AgentSessionWorkspaceSource
  workspacePath?: string
}

function SessionListOptionsMenu({
  mode,
  onChange,
  onToggleSidebar,
  sectionId
}: {
  mode: AgentSessionDisplayMode
  onChange: (mode: AgentSessionDisplayMode) => void
  onToggleSidebar: () => void
  sectionId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceList.HeaderActionButton type="button" aria-label={t('agent.session.display.title')}>
          <ListFilter className="block" />
        </ResourceList.HeaderActionButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 p-1">
        <MenuList>
          <div className="px-2.5 py-1 font-medium text-muted-foreground text-xs">
            {t('agent.session.display.title')}
          </div>
          {SESSION_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              size="sm"
              icon={SESSION_DISPLAY_ICONS[option]}
              label={t(SESSION_DISPLAY_LABEL_KEYS[option])}
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
                expandLabel={t('agent.session.group.expand_all')}
                collapseLabel={t('agent.session.group.collapse_all')}
                onClick={() => {
                  setOpen(false)
                }}
              />
            </>
          )}
          <MenuDivider />
          <MenuItem
            size="sm"
            icon={<PanelLeft size={16} />}
            label={t('settings.shortcuts.toggle_left_sidebar')}
            onClick={() => {
              onToggleSidebar()
              setOpen(false)
            }}
          />
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

function AgentGroupMoreMenu({
  agentId,
  deleteSessionsDisabled,
  pinDisabled,
  pinned,
  onDeleteSessions,
  onEdit,
  onTogglePin
}: {
  agentId: string
  deleteSessionsDisabled?: boolean
  pinDisabled?: boolean
  pinned: boolean
  onDeleteSessions: (agentId: string) => void | Promise<void>
  onEdit: (agentId: string) => void
  onTogglePin: (agentId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionContext: AgentGroupActionContext = {
    agentId,
    deleteSessionsDisabled,
    onDeleteSessions,
    onEdit,
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

export function buildCreateSessionSeed(
  session: Pick<AgentSessionEntity, 'agentId' | 'workspaceId' | 'workspace'> | null | undefined
): CreateSessionSeed | null {
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

export function findLatestCreateSessionSeed(
  sessions: readonly SessionListItem[],
  predicate: (session: SessionListItem) => boolean = () => true
): CreateSessionSeed | null {
  let latestSession: SessionListItem | null = null
  let latestUpdatedAtMs = Number.NEGATIVE_INFINITY

  for (const session of sessions) {
    if (session.pinned || !predicate(session)) continue

    const parsedUpdatedAtMs = Date.parse(session.updatedAt)
    const updatedAtMs = Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : Number.NEGATIVE_INFINITY
    if (!latestSession || updatedAtMs > latestUpdatedAtMs) {
      latestSession = session
      latestUpdatedAtMs = updatedAtMs
    }
  }

  return buildCreateSessionSeed(latestSession)
}

const Sessions = ({
  activeSessionId,
  onSelectItem,
  onStartDraftSession,
  onStartMissingAgentDraft,
  revealRequest,
  setActiveSessionId: setControlledActiveSessionId
}: SessionsProps) => {
  const { t } = useTranslation()
  const conversationNav = useConversationNavigation('agents')
  const [groupNow] = useState(() => new Date())
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [sessionExpansionTime, setSessionExpansionTime] = usePersistCache('ui.agent.session.expansion.time')
  const [sessionExpansionAgent, setSessionExpansionAgent] = usePersistCache('ui.agent.session.expansion.agent')
  const [sessionExpansionWorkdir, setSessionExpansionWorkdir] = usePersistCache('ui.agent.session.expansion.workdir')
  const {
    sessions,
    pinIdBySessionId,
    isLoading,
    isLoadingAll,
    isFullyLoaded,
    isPinsLoading: isSessionPinsLoading,
    error,
    deleteSession,
    hasMore,
    isLoadingMore,
    isValidating,
    reload,
    reorderSession,
    togglePin
  } = useSessions(undefined, { loadAll: true, pageSize: 200 })
  const currentTabId = useCurrentTabId()
  const { agents, error: agentsError, isLoading: isAgentsLoading, refetch: refetchAgents } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [optimisticAgentOrderIds, setOptimisticAgentOrderIds] = useState<string[] | null>(null)
  const [optimisticWorkspaceOrderIds, setOptimisticWorkspaceOrderIds] = useState<string[] | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [deletingAgentGroupId, setDeletingAgentGroupId] = useState<string | null>(null)
  const deletingAgentGroupIdRef = useRef<string | null>(null)
  const [deletingWorkspaceGroupId, setDeletingWorkspaceGroupId] = useState<string | null>(null)
  const [renamingWorkspaceGroup, setRenamingWorkspaceGroup] = useState<{
    name: string
    workspaceId: string
  } | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const { data: channels } = useQuery('/agent-channels')
  const channelTypeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ch of channels ?? []) {
      if (ch.sessionId) map[ch.sessionId] = ch.type
    }
    return map
  }, [channels])

  const displayMode: AgentSessionDisplayMode =
    sessionDisplayMode === 'workdir' || sessionDisplayMode === 'agent' ? sessionDisplayMode : 'time'
  const isDraggableMode = displayMode !== 'time'
  const sessionExpansion =
    displayMode === 'agent'
      ? sessionExpansionAgent
      : displayMode === 'workdir'
        ? sessionExpansionWorkdir
        : sessionExpansionTime

  const dragReady = isDraggableMode && isFullyLoaded && !isLoadingAll && !isLoadingMore && !isValidating && !isLoading
  const {
    isLoading: isAgentPinsLoading,
    isRefreshing: isAgentPinsRefreshing,
    isMutating: isAgentPinsMutating,
    pinnedIds: agentPinnedIds,
    togglePin: toggleAgentPin
  } = usePins('agent', { enabled: displayMode === 'agent' })
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating

  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: pinIdBySessionId.has(session.id) })),
    [pinIdBySessionId, sessions]
  )
  const sessionItemsRef = useRef(sessionItems)
  const activeSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    sessionItemsRef.current = sessionItems
  }, [sessionItems])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const setActiveSessionId = useCallback(
    (id: string | null) => {
      // One tab per session: if this session is already open in another tab,
      // focus that tab instead of navigating the current one (avoids a duplicate
      // tab). The page owns session changes and syncs the current instance key
      // through tab metadata.
      if (id && conversationNav.focusExistingTab(id, { excludeTabId: currentTabId ?? undefined })) return
      const session = id ? (sessionItemsRef.current.find((candidate) => candidate.id === id) ?? null) : null
      setControlledActiveSessionId(id, session)
    },
    [conversationNav, currentTabId, setControlledActiveSessionId]
  )

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
  const workdirDragReady =
    displayMode === 'workdir' && dragReady && !isWorkdirMetadataLoading && !isWorkdirMetadataRefreshing
  const agentDragReady = displayMode === 'agent' && dragReady && !isAgentsLoading
  const itemDragReady = displayMode === 'workdir' ? workdirDragReady : agentDragReady
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
  const workdirDisplay = useMemo(
    () => createSessionWorkdirDisplayMaps(sessionItems, workspaceRowsForDisplay),
    [sessionItems, workspaceRowsForDisplay]
  )
  const workspaceOrderSignature = useMemo(
    () => workspaceRows.map((workspace) => `${workspace.id}:${workspace.orderKey}`).join('|'),
    [workspaceRows]
  )
  const agentOrderSignature = useMemo(
    () => agents.map((agent) => `${agent.id}:${agent.orderKey ?? ''}`).join('|'),
    [agents]
  )

  const baseGroupedSessions = useMemo(
    () =>
      sortSessionsForDisplayGroups(sessionItems, {
        agentRankById,
        mode: displayMode,
        now: groupNow,
        workdirDisplay
      }),
    [agentRankById, displayMode, groupNow, sessionItems, workdirDisplay]
  )

  const groupedSessions = useMemo(
    () =>
      optimisticMove ? applyOptimisticSessionDisplayMove(baseGroupedSessions, optimisticMove) : baseGroupedSessions,
    [baseGroupedSessions, optimisticMove]
  )
  const headerCreateSessionSeed = useMemo(() => findLatestCreateSessionSeed(groupedSessions), [groupedSessions])

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

  const sessionGroupBy = useMemo(
    () =>
      createSessionDisplayGroupResolver({
        agentById,
        labels: {
          pinned: t('selector.common.pinned_title'),
          time: {
            today: t('agent.session.group.today'),
            yesterday: t('agent.session.group.yesterday'),
            'this-week': t('agent.session.group.this_week'),
            earlier: t('agent.session.group.earlier')
          },
          agent: {
            unknown: t('agent.session.group.unknown_agent')
          },
          workdir: {
            none: t('agent.session.group.no_workdir')
          }
        },
        mode: displayMode,
        now: groupNow,
        pinnedAsSection: displayMode !== 'time',
        workdirDisplay
      }),
    [agentById, displayMode, groupNow, t, workdirDisplay]
  )

  const sessionSectionBy = useMemo(() => {
    if (displayMode === 'time') return undefined

    return (session: SessionListItem): ResourceListSection => {
      if (session.pinned) {
        return { id: SESSION_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      }

      if (displayMode === 'workdir' && isSystemWorkspaceSession(session)) {
        return { id: SESSION_NO_PROJECT_SECTION_ID, label: t('agent.session.group.no_workdir') }
      }

      return {
        id: displayMode === 'agent' ? SESSION_AGENT_SECTION_ID : SESSION_WORKDIR_SECTION_ID,
        label: t(SESSION_DISPLAY_LABEL_KEYS[displayMode])
      }
    }
  }, [displayMode, t])

  const collapsedSessionState = useMemo(() => {
    if (displayMode !== 'workdir') {
      return sessionExpansion
    }

    return remapResourceListCollapsedGroupIds(sessionExpansion, (groupId) => {
      const path = getWorkdirPathFromSessionGroupId(groupId)
      return path ? (workdirDisplay.groupIdByPath.get(path) ?? groupId) : groupId
    })
  }, [displayMode, sessionExpansion, workdirDisplay])

  const handleSessionCollapsedStateChange = useCallback(
    (nextCollapsedIds: string[]) => {
      if (displayMode === 'agent') setSessionExpansionAgent(nextCollapsedIds)
      else if (displayMode === 'workdir') setSessionExpansionWorkdir(nextCollapsedIds)
      else setSessionExpansionTime(nextCollapsedIds)
    },
    [displayMode, setSessionExpansionAgent, setSessionExpansionTime, setSessionExpansionWorkdir]
  )
  const getCreateSessionSeedForGroup = useCallback(
    (groupId: string) =>
      findLatestCreateSessionSeed(groupedSessions, (session) => sessionGroupBy(session)?.id === groupId),
    [groupedSessions, sessionGroupBy]
  )
  const handleToggleSidebar = useCallback(() => {
    void setShowSidebar(!showSidebar)
  }, [setShowSidebar, showSidebar])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const success = await deleteSession(id)
      if (success && activeSessionId === id) {
        const remaining = sessionItems.find((s) => s.id !== id)
        setActiveSessionId(remaining?.id ?? null)
      }
    },
    [activeSessionId, deleteSession, sessionItems, setActiveSessionId]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessionItems.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      try {
        const updatedSession = await updateSession({ id, name: trimmedName }, { showSuccessToast: false })
        if (updatedSession) {
          window.toast.success(t('common.saved'))
        }
      } catch (err) {
        logger.error('Failed to rename session', { err, sessionId: id })
        window.toast.error(t('agent.session.update.error.failed'))
      }
    },
    [sessionItems, t, updateSession]
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
    refresh: ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const { trigger: deleteAgentSessions } = useMutation('DELETE', '/agents/:agentId/sessions', {
    refresh: ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const { trigger: reorderWorkspace } = useMutation('PATCH', '/agent-workspaces/:id/order')
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })

  const createSessionFromSeed = useCallback(
    async (seed: CreateSessionSeed | null | undefined) => {
      if (creatingSession) return null
      if (!seed?.agentId) {
        const defaultAgent = agentsForDisplay[0]
        if (defaultAgent) {
          await onStartDraftSession?.({
            agentId: defaultAgent.id,
            workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
          })
          setActiveSessionId(null)
          return null
        }

        await onStartMissingAgentDraft?.()
        return null
      }

      const agent = agentById.get(seed.agentId)
      if (!agent) return null

      setCreatingSession(true)
      try {
        const workspace =
          seed.workspace ??
          (seed.workspacePath
            ? ({
                type: AGENT_WORKSPACE_TYPE.USER,
                workspaceId: (await findOrCreateWorkspace({ body: { path: seed.workspacePath } })).id
              } satisfies AgentSessionWorkspaceSource)
            : ({ type: AGENT_WORKSPACE_TYPE.SYSTEM } satisfies AgentSessionWorkspaceSource))

        await onStartDraftSession?.({
          agentId: seed.agentId,
          workspace
        })

        setActiveSessionId(null)
        return null
      } catch (err) {
        logger.error('Failed to create session from session list', { err, agentId: seed.agentId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
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
      onStartMissingAgentDraft,
      onStartDraftSession,
      setActiveSessionId,
      t
    ]
  )

  const handleHeaderCreateSession = useCallback(() => {
    void createSessionFromSeed(headerCreateSessionSeed)
  }, [createSessionFromSeed, headerCreateSessionSeed])

  const handleRetry = useCallback(async () => {
    await reload()
    if (displayMode === 'workdir') {
      await refetchWorkspaces()
    }
  }, [displayMode, refetchWorkspaces, reload])

  const handleDeleteAgentSessions = useCallback(
    async (agentId: string) => {
      if (deletingAgentGroupIdRef.current) return

      const sessionIds = sessionItemsRef.current
        .filter((session) => session.agentId === agentId)
        .map((session) => session.id)
      if (sessionIds.length === 0) return

      deletingAgentGroupIdRef.current = agentId
      setDeletingAgentGroupId(agentId)

      try {
        const confirmed = await window.modal.confirm({
          title: t('agent.session.agent.delete.title'),
          content: t('agent.session.agent.delete.content'),
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        const result = await deleteAgentSessions({ params: { agentId } })
        const affectedSessionIds = new Set(result.deletedIds)
        const currentActiveSessionId = activeSessionIdRef.current

        if (currentActiveSessionId && affectedSessionIds.has(currentActiveSessionId)) {
          const remaining = sessionItemsRef.current.find((session) => !affectedSessionIds.has(session.id))
          setActiveSessionId(remaining?.id ?? null)
        }

        await reload()
        await refetchWorkspaces()
        window.toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete agent sessions', { agentId, err, sessionIds })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.agent.delete.error.failed')))
      } finally {
        deletingAgentGroupIdRef.current = null
        setDeletingAgentGroupId(null)
      }
    },
    [deleteAgentSessions, refetchWorkspaces, reload, setActiveSessionId, t]
  )

  const handleDeleteWorkdirGroup = useCallback(
    async (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId || deletingWorkspaceGroupId) return

      const sessionIds = sessionItems
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => session.id)
      if (sessionIds.length === 0) return

      const confirmed = await window.modal.confirm({
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
      const affectedSessionIds = new Set(sessionIds)

      try {
        await deleteWorkspace({ params: { workspaceId } })

        if (activeSessionId && affectedSessionIds.has(activeSessionId)) {
          const remaining = sessionItems.find((session) => !affectedSessionIds.has(session.id))
          setActiveSessionId(remaining?.id ?? null)
        }

        await reload()
        await refetchWorkspaces()
        window.toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete workspace group', { err, sessionIds, workspaceId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.delete.error.failed')))
      } finally {
        setDeletingWorkspaceGroupId(null)
      }
    },
    [
      activeSessionId,
      deleteWorkspace,
      deletingWorkspaceGroupId,
      refetchWorkspaces,
      reload,
      sessionItems,
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
        window.toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename workspace group', { err, workspaceId: target.workspaceId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.rename.error.failed')))
      }
    },
    [renamingWorkspaceGroup, t, updateWorkspace]
  )

  const handleOpenWorkdirGroup = useCallback(
    async (workdirPath: string) => {
      try {
        await window.api.file.openPath(workdirPath)
      } catch (err) {
        window.toast.error(formatErrorMessageWithPrefix(err, t('files.error.open_path', { path: workdirPath })))
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
        await refetchAgents()
      } catch (err) {
        logger.error('Failed to toggle agent pin from session group', { agentId, err })
        window.toast.error(t('common.error'))
      }
    },
    [isAgentPinActionDisabled, refetchAgents, t, toggleAgentPin]
  )

  const handleSelectSession = useCallback(
    (id: string | null) => {
      setActiveSessionId(id)
    },
    [setActiveSessionId]
  )
  const getGroupHeaderClickBehavior = useCallback(
    (group: ResourceListGroup) =>
      displayMode === 'agent' && group.id !== SESSION_PINNED_GROUP_ID ? 'select-first-then-toggle' : 'toggle',
    [displayMode]
  )
  const canDragSessionItem = useCallback(
    ({ item }: { item: SessionListItem }) => itemDragReady && !item.pinned,
    [itemDragReady]
  )

  const canDropSessionItem = useCallback(
    ({ sourceGroupId, targetGroupId }: { sourceGroupId: string; targetGroupId: string }) =>
      itemDragReady && canDropSessionItemInDisplayGroup({ mode: displayMode, sourceGroupId, targetGroupId }),
    [displayMode, itemDragReady]
  )

  const canDragSessionGroup = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        return agentDragReady && !!agentId && agentById.has(agentId)
      }

      return workdirDragReady && workdirDisplay.workspaceIdByGroupId.has(group.id)
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
            await refetchAgents()
            setOptimisticAgentOrderIds(null)
          } catch (err) {
            setOptimisticAgentOrderIds(null)
            logger.error('Failed to reorder agent session group', { activeAgentId, err, overAgentId })
            window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))

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
          window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))

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

      if (!itemDragReady) return
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
      refetchAgents,
      refetchWorkspaces,
      reorderAgent,
      reorderSession,
      reorderWorkspace,
      sessionItems,
      t,
      workdirDragReady,
      workdirDisplay,
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
      const createSessionSeed = getCreateSessionSeedForGroup(group.id)
      const canCreateSession = createSessionSeed !== null && agentById.has(createSessionSeed.agentId)
      const canManageAgentGroup = !!agentGroupId && agentById.has(agentGroupId)
      const hasAgentSessions = !!agentGroupId && sessionItems.some((session) => session.agentId === agentGroupId)

      if (!canCreateSession && !workdirPath && !canManageAgentGroup) return null

      return (
        <>
          {canManageAgentGroup && agentGroupId && (
            <Tooltip title={t('common.more')} delay={500}>
              <AgentGroupMoreMenu
                agentId={agentGroupId}
                deleteSessionsDisabled={!!deletingAgentGroupId || !hasAgentSessions}
                pinDisabled={isAgentPinActionDisabled}
                pinned={agentPinnedIdSet.has(agentGroupId)}
                onDeleteSessions={handleDeleteAgentSessions}
                onEdit={openAgentEditor}
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
            <Tooltip title={t('chat.conversation.new')} delay={500}>
              <ResourceList.GroupHeaderActionButton
                type="button"
                aria-label={t('chat.conversation.new')}
                disabled={creatingSession}
                onClick={(event) => {
                  event.stopPropagation()
                  void createSessionFromSeed(createSessionSeed)
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
      createSessionFromSeed,
      creatingSession,
      deletingAgentGroupId,
      deletingWorkspaceGroupId,
      displayMode,
      getCreateSessionSeedForGroup,
      handleDeleteAgentSessions,
      handleToggleAgentPin,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      sessionItems,
      t,
      workdirDisplay
    ]
  )

  const getSectionHeaderAction = useCallback(
    (section: ResourceListSection) => {
      if (section.id !== SESSION_NO_PROJECT_SECTION_ID) return null

      const createSessionSeed = findLatestCreateSessionSeed(groupedSessions, isSystemWorkspaceSession)
      const canCreateSession = createSessionSeed !== null && agentById.has(createSessionSeed.agentId)
      if (!canCreateSession) return null

      return (
        <Tooltip title={t('chat.conversation.new')} delay={500}>
          <ResourceList.GroupHeaderActionButton
            type="button"
            aria-label={t('chat.conversation.new')}
            disabled={creatingSession}
            onClick={(event) => {
              event.stopPropagation()
              void createSessionFromSeed(createSessionSeed)
            }}>
            <SquarePen className="block" />
          </ResourceList.GroupHeaderActionButton>
        </Tooltip>
      )
    },
    [agentById, createSessionFromSeed, creatingSession, groupedSessions, t]
  )

  const getGroupHeaderIcon = useCallback(
    (group: ResourceListGroup, context: { collapsed: boolean }) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return undefined

      if (displayMode === 'workdir') {
        if (group.id === SESSION_NO_WORKDIR_GROUP_ID || group.id === SESSION_NO_PROJECT_GROUP_ID) return null
        if (!context.collapsed) return <FolderOpen size={13} />

        return (
          <span className="flex size-4 items-center justify-center text-foreground/70 group-focus-within/resource-list-group:text-foreground group-hover/resource-list-group:text-foreground">
            <Folder size={13} className="block group-hover/resource-list-group:hidden" />
            <FolderOpen size={13} className="hidden group-hover/resource-list-group:block" />
          </span>
        )
      }

      if (displayMode !== 'agent') return undefined
      if (group.id === SESSION_UNKNOWN_AGENT_GROUP_ID) return null

      const agentId = getAgentIdFromSessionGroupId(group.id)
      const agent = agentId ? agentById.get(agentId) : undefined
      return (
        <EmojiIcon
          emoji={getAgentAvatarFromConfiguration(agent?.configuration)}
          size={24}
          fontSize={14}
          className="mr-0"
        />
      )
    },
    [agentById, displayMode]
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
          deleteSessionsDisabled:
            !!deletingAgentGroupId || !sessionItems.some((session) => session.agentId === agentId),
          onDeleteSessions: handleDeleteAgentSessions,
          onEdit: openAgentEditor,
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
      deletingAgentGroupId,
      deletingWorkspaceGroupId,
      displayMode,
      handleDeleteAgentSessions,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      handleToggleAgentPin,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      sessionItems,
      t,
      workdirDisplay
    ]
  )

  const listError =
    error ?? (displayMode === 'agent' ? agentsError : displayMode === 'workdir' ? workspacesError : undefined)
  const listLoading =
    isLoadingAll ||
    !isFullyLoaded ||
    isSessionPinsLoading ||
    isWorkdirMetadataLoading ||
    (displayMode === 'agent' && isAgentsLoading)
  const listValidating = isValidating || isWorkdirMetadataRefreshing
  const visibleGroupedSessions = useMemo(() => (listLoading ? [] : groupedSessions), [groupedSessions, listLoading])
  const listStatus = listError ? 'error' : listLoading ? 'loading' : groupedSessions.length === 0 ? 'empty' : 'idle'

  return (
    <SessionResourceList<SessionListItem>
      items={visibleGroupedSessions}
      status={listStatus}
      selectedId={activeSessionId}
      groupBy={sessionGroupBy}
      sectionBy={sessionSectionBy}
      collapsedState={collapsedSessionState}
      revealRequest={revealRequest}
      defaultGroupVisibleCount={5}
      groupLoadStep={5}
      getSectionHeaderAction={getSectionHeaderAction}
      getGroupHeaderAction={getGroupHeaderAction}
      getGroupHeaderClassName={getGroupHeaderClassName}
      getGroupHeaderContextMenu={getGroupHeaderContextMenu}
      getGroupHeaderIcon={getGroupHeaderIcon}
      getGroupHeaderTooltip={getGroupHeaderTooltip}
      groupHeaderClickBehavior={getGroupHeaderClickBehavior}
      dragCapabilities={{
        groups: displayMode === 'agent' ? agentDragReady : workdirDragReady,
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
      onGroupHeaderSelectItem={handleSelectSession}
      onReorder={handleSessionReorder}
      onCollapsedStateChange={handleSessionCollapsedStateChange}>
      <ResourceList.Header className="gap-1">
        <ResourceList.HeaderItem
          type="button"
          command="topic.create"
          aria-label={t('agent.session.add.title')}
          disabled={creatingSession || (!headerCreateSessionSeed && !onStartMissingAgentDraft)}
          icon={<SquarePen />}
          label={t('agent.session.add.title')}
          onClick={handleHeaderCreateSession}
          actions={
            <SessionListOptionsMenu
              mode={displayMode}
              onChange={(nextMode) => void setSessionDisplayMode(nextMode)}
              onToggleSidebar={handleToggleSidebar}
              sectionId={
                displayMode === 'agent'
                  ? SESSION_AGENT_SECTION_ID
                  : displayMode === 'workdir'
                    ? SESSION_WORKDIR_SECTION_ID
                    : undefined
              }
            />
          }
        />
      </ResourceList.Header>
      <SessionListBody
        activeSessionId={activeSessionId}
        channelTypeMap={channelTypeMap}
        displayMode={displayMode}
        error={listError}
        isDraggable={itemDragReady}
        isValidating={listValidating}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onOpenInNewTab={openSessionInNewTab}
        onOpenInNewWindow={openSessionInNewWindow}
        onRetry={handleRetry}
        onSelectItem={onSelectItem}
        onTogglePin={togglePin}
        setActiveSessionId={handleSelectSession}
      />
      {!listLoading && (isLoadingMore || hasMore) && (
        <div className="shrink-0 px-3 py-2 text-center text-[11px] text-muted-foreground/55">{t('common.loading')}</div>
      )}
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
    </SessionResourceList>
  )
}

interface SessionListBodyProps {
  activeSessionId: string | null
  channelTypeMap: Record<string, string>
  displayMode: AgentSessionDisplayMode
  error?: unknown
  isDraggable: boolean
  isValidating: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDeleteSession: (id: string) => Promise<void>
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onOpenInNewWindow?: (session: AgentSessionEntity) => void
  onRetry: () => Promise<unknown>
  onSelectItem?: () => void
  onTogglePin: (id: string) => Promise<void>
  setActiveSessionId: (id: string | null) => void
}

function SessionListBody({
  activeSessionId,
  channelTypeMap,
  displayMode,
  error,
  isDraggable,
  isValidating,
  listRef,
  onDeleteSession,
  onOpenInNewTab,
  onOpenInNewWindow,
  onRetry,
  onSelectItem,
  onTogglePin,
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
        onPress={setActiveSessionId}
        onSelectItem={onSelectItem}
      />
    ),
    [
      activeSessionId,
      channelTypeMap,
      displayMode,
      onDeleteSession,
      onOpenInNewTab,
      onOpenInNewWindow,
      onSelectItem,
      onTogglePin,
      setActiveSessionId
    ]
  )

  return (
    <ResourceList.Body<SessionListItem>
      listRef={listRef}
      draggable={isDraggable}
      virtualClassName="pt-0 pb-3"
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
        <ResourceList.EmptyState
          compact
          preset="no-session"
          className="min-h-60 px-5 py-10"
          title={t('agent.session.empty.title')}
          description={t('agent.session.empty.description')}
        />
      }
      renderItem={renderItem}
    />
  )
}

export default memo(Sessions)
