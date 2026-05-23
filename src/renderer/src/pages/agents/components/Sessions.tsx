import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ActionMenu } from '@renderer/components/chat/actions/ActionMenu'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  ResourceList,
  type ResourceListGroup,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  SessionResourceList
} from '@renderer/components/chat/resources'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { FinderIcon } from '@renderer/components/Icons/SVGIcon'
import { isMac, isWin } from '@renderer/config/constant'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useSessions, useUpdateSession } from '@renderer/hooks/agents/useSession'
import { usePins } from '@renderer/hooks/usePins'
import type { TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import { buildLibraryEditSearch, buildLibraryRouteUrl } from '@renderer/pages/library/routeSearch'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { WorkspaceEntity } from '@shared/data/api/schemas/workspaces'
import type { TFunction } from 'i18next'
import { Bot, FolderOpen, ListFilter, MoreHorizontal, Pin, PinOff, SquarePen, Trash2 } from 'lucide-react'
import { Fragment, memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildAgentSessionMessageRouteUrl } from '../routeSearch'
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
  moveSessionAgentGroupAfterDrop,
  moveSessionWorkdirGroupAfterDrop,
  normalizeSessionDropPayload,
  SESSION_NO_WORKDIR_GROUP_ID,
  SESSION_PINNED_GROUP_ID,
  SESSION_UNKNOWN_AGENT_GROUP_ID,
  type SessionListItem,
  sortSessionsForDisplayGroups
} from './SessionList.helpers'

interface SessionsProps {
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  onSelectItem?: () => void
  onDiscardTemporarySession?: () => void | Promise<void>
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
}

const logger = loggerService.withContext('AgentSessions')

const SESSION_DISPLAY_OPTIONS: AgentSessionDisplayMode[] = ['time', 'agent', 'workdir']
const SESSION_DISPLAY_LABEL_KEYS: Record<AgentSessionDisplayMode, string> = {
  agent: 'agent.session.display.agent',
  time: 'agent.session.display.time',
  workdir: 'agent.session.display.workdir'
}
const EMPTY_WORKSPACE_ROWS: WorkspaceEntity[] = []
type CreateSessionSeed = { agentId: string; workspaceId?: string; workspacePath?: string }

function SessionListOptionsMenu({
  mode,
  onChange,
  historyLabel,
  onOpenHistory
}: {
  mode: AgentSessionDisplayMode
  onChange: (mode: AgentSessionDisplayMode) => void
  historyLabel: string
  onOpenHistory: (origin?: DOMRectReadOnly) => void
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
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="w-32 rounded-lg border-border/80 p-1 shadow-lg">
        <MenuList className="gap-0.5">
          <div className="px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground/60">
            {t('agent.session.display.title')}
          </div>
          {SESSION_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              label={t(SESSION_DISPLAY_LABEL_KEYS[option])}
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
            label={historyLabel}
            className="h-6 rounded-lg px-1.5 py-0 font-normal text-[11px] text-muted-foreground/75 hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              onOpenHistory(event.currentTarget.getBoundingClientRect())
              setOpen(false)
            }}
          />
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

type AgentGroupActionId = 'agent-group.edit' | 'agent-group.toggle-pin'
type AgentGroupAction = ResolvedAction & { id: AgentGroupActionId }

function resolveAgentGroupActions({
  pinDisabled,
  pinned,
  t
}: {
  pinDisabled?: boolean
  pinned: boolean
  t: TFunction
}): AgentGroupAction[] {
  return [
    {
      id: 'agent-group.edit' satisfies AgentGroupActionId,
      label: t('agent.edit.title'),
      icon: <SquarePen size={14} />,
      danger: false,
      availability: { visible: true, enabled: true },
      children: []
    },
    {
      id: 'agent-group.toggle-pin' satisfies AgentGroupActionId,
      label: pinned ? t('chat.topics.unpin') : t('chat.topics.pin'),
      icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
      danger: false,
      availability: { visible: true, enabled: !pinDisabled },
      children: []
    }
  ]
}

function GroupMoreDropdownMenuContent<TAction extends ResolvedAction>({
  actions,
  onAction
}: {
  actions: readonly TAction[]
  onAction: (action: TAction) => void
}) {
  let previousGroup: string | undefined

  return (
    <>
      {actions.map((action, index) => {
        const separatorBefore = index > 0 && action.group !== previousGroup
        previousGroup = action.group

        return (
          <Fragment key={action.id}>
            {separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={!action.availability.enabled}
              variant={action.danger ? 'destructive' : 'default'}
              onSelect={(event) => {
                event.stopPropagation()
                onAction(action)
              }}>
              {action.icon}
              <span>{action.label}</span>
            </DropdownMenuItem>
          </Fragment>
        )
      })}
    </>
  )
}

function AgentGroupMoreMenu({
  agentId,
  pinDisabled,
  pinned,
  onEdit,
  onTogglePin
}: {
  agentId: string
  pinDisabled?: boolean
  pinned: boolean
  onEdit: (agentId: string) => void
  onTogglePin: (agentId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actions = resolveAgentGroupActions({ pinDisabled, pinned, t })
  const handleAction = (action: AgentGroupAction) => {
    if (action.id === 'agent-group.edit') {
      window.requestAnimationFrame(() => onEdit(agentId))
      return
    }
    if (action.id === 'agent-group.toggle-pin') {
      void onTogglePin(agentId)
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
        <GroupMoreDropdownMenuContent actions={actions} onAction={handleAction} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type WorkdirGroupActionId = 'workdir-group.open' | 'workdir-group.rename' | 'workdir-group.delete'
type WorkdirGroupAction = ResolvedAction & { id: WorkdirGroupActionId; label: string }

function resolveWorkdirGroupActions({
  canDelete,
  canRename,
  deleteDisabled,
  fileManagerName,
  renameDisabled,
  t
}: {
  canDelete: boolean
  canRename: boolean
  deleteDisabled?: boolean
  fileManagerName: string
  renameDisabled?: boolean
  t: TFunction
}): WorkdirGroupAction[] {
  const actions: WorkdirGroupAction[] = [
    {
      id: 'workdir-group.open' satisfies WorkdirGroupActionId,
      label: t('common.open_in', { name: fileManagerName }),
      icon: isMac ? <FinderIcon className="size-3.5" /> : <FolderOpen size={14} />,
      danger: false,
      availability: { visible: true, enabled: true },
      children: []
    }
  ]

  if (canRename) {
    actions.push({
      id: 'workdir-group.rename' satisfies WorkdirGroupActionId,
      label: t('agent.session.workdir.rename.trigger'),
      icon: <SquarePen size={14} />,
      danger: false,
      availability: { visible: true, enabled: !renameDisabled },
      children: []
    })
  }

  if (canDelete) {
    actions.push({
      id: 'workdir-group.delete' satisfies WorkdirGroupActionId,
      label: t('agent.session.workdir.delete.trigger'),
      icon: <Trash2 size={14} className="lucide-custom text-destructive" />,
      group: 'danger',
      danger: true,
      availability: { visible: true, enabled: !deleteDisabled },
      children: []
    })
  }

  return actions
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
  const fileManagerName = isMac
    ? t('agent.session.file_manager.finder')
    : isWin
      ? t('agent.session.file_manager.file_explorer')
      : t('agent.session.file_manager.files')
  const actions = resolveWorkdirGroupActions({
    canDelete,
    canRename,
    deleteDisabled,
    fileManagerName,
    renameDisabled,
    t
  })
  const handleAction = (action: WorkdirGroupAction) => {
    if (action.id === 'workdir-group.open') {
      void onOpen(workdirPath)
      return
    }
    if (action.id === 'workdir-group.rename') {
      void onRename(group)
      return
    }
    if (action.id === 'workdir-group.delete') {
      void onDelete(group)
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
        <GroupMoreDropdownMenuContent actions={actions} onAction={handleAction} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function buildCreateSessionSeed(
  session: Pick<AgentSessionEntity, 'agentId' | 'workspaceId' | 'workspace'> | null | undefined
): CreateSessionSeed | null {
  if (!session?.agentId) return null

  if (session.workspaceId) {
    return { agentId: session.agentId, workspaceId: session.workspaceId }
  }

  if (session.workspace?.path) {
    return { agentId: session.agentId, workspacePath: session.workspace.path }
  }

  return { agentId: session.agentId }
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
  onOpenHistory,
  onSelectItem,
  onDiscardTemporarySession,
  onStartTemporarySession,
  revealRequest
}: SessionsProps) => {
  const { t } = useTranslation()
  const tabs = useOptionalTabsContext()
  const [groupNow] = useState(() => new Date())
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [collapsedSessionGroupIds, setCollapsedSessionGroupIds] = usePreference('agent.session.collapsed_group_ids')
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
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const { agents, error: agentsError, isLoading: isAgentsLoading, refetch: refetchAgents } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [optimisticAgentOrderIds, setOptimisticAgentOrderIds] = useState<string[] | null>(null)
  const [optimisticWorkspaceOrderIds, setOptimisticWorkspaceOrderIds] = useState<string[] | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [deletingWorkspaceGroupId, setDeletingWorkspaceGroupId] = useState<string | null>(null)
  const [renamingWorkspaceGroup, setRenamingWorkspaceGroup] = useState<{
    name: string
    workspaceId: string
  } | null>(null)

  const { data: channels } = useQuery('/channels')
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
  } = useQuery('/workspaces', { enabled: displayMode === 'workdir' })
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
        workdirDisplay
      }),
    [agentById, displayMode, groupNow, t, workdirDisplay]
  )

  const effectiveCollapsedSessionGroupIds = useMemo(() => {
    if (displayMode !== 'workdir') return collapsedSessionGroupIds

    return Array.from(
      new Set(
        collapsedSessionGroupIds.map((groupId) => {
          const path = getWorkdirPathFromSessionGroupId(groupId)
          return path ? (workdirDisplay.groupIdByPath.get(path) ?? groupId) : groupId
        })
      )
    )
  }, [collapsedSessionGroupIds, displayMode, workdirDisplay])

  const handleCollapsedSessionGroupIdsChange = useCallback(
    (nextGroupIds: string[]) => void setCollapsedSessionGroupIds(nextGroupIds),
    [setCollapsedSessionGroupIds]
  )
  const getCreateSessionSeedForGroup = useCallback(
    (groupId: string) =>
      findLatestCreateSessionSeed(groupedSessions, (session) => sessionGroupBy(session)?.id === groupId),
    [groupedSessions, sessionGroupBy]
  )
  const handleOpenHistoryOrToggleSidebar = useCallback(
    (origin?: DOMRectReadOnly) => {
      if (onOpenHistory) {
        onOpenHistory(origin)
        return
      }

      void setShowSidebar(!showSidebar)
    },
    [onOpenHistory, setShowSidebar, showSidebar]
  )

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

  const { trigger: findOrCreateWorkspace } = useMutation('POST', '/workspaces', { refresh: ['/workspaces'] })
  const { trigger: updateWorkspace, isLoading: isUpdatingWorkspace } = useMutation(
    'PATCH',
    '/workspaces/:workspaceId',
    {
      refresh: ['/workspaces', '/sessions']
    }
  )
  const { trigger: deleteWorkspace } = useMutation('DELETE', '/workspaces/:workspaceId', {
    refresh: ['/sessions', '/workspaces', '/pins', '/channels']
  })
  const { trigger: reorderWorkspace } = useMutation('PATCH', '/workspaces/:id/order')
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })

  const createSessionFromSeed = useCallback(
    async (seed: CreateSessionSeed | null | undefined) => {
      if (!seed?.agentId || creatingSession) return null

      const agent = agentById.get(seed.agentId)
      if (!agent) return null

      setCreatingSession(true)
      try {
        const workspaceId = seed.workspaceId
          ? seed.workspaceId
          : seed.workspacePath
            ? (await findOrCreateWorkspace({ body: { path: seed.workspacePath } })).id
            : undefined

        await onStartTemporarySession?.({
          agentId: seed.agentId,
          name: t('common.unnamed'),
          ...(workspaceId ? { workspaceId } : {})
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
    [agentById, creatingSession, findOrCreateWorkspace, onStartTemporarySession, setActiveSessionId, t]
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

  const openAgentEditor = useCallback(
    (agentId: string) => {
      tabs?.openTab(buildLibraryRouteUrl(buildLibraryEditSearch('agent', agentId)), { forceNew: true })
    },
    [tabs]
  )
  const openSessionInNewTab = useCallback(
    (session: AgentSessionEntity) => {
      tabs?.openTab(buildAgentSessionMessageRouteUrl(session.id), {
        forceNew: true,
        title: session.name || t('common.unnamed')
      })
    },
    [tabs, t]
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
      if (id) void onDiscardTemporarySession?.()
      setActiveSessionId(id)
    },
    [onDiscardTemporarySession, setActiveSessionId]
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

      const agentGroupId = displayMode === 'agent' ? getAgentIdFromSessionGroupId(group.id) : undefined
      const workspaceId = displayMode === 'workdir' ? workdirDisplay.workspaceIdByGroupId.get(group.id) : undefined
      const workdirPath =
        displayMode === 'workdir'
          ? (workdirDisplay.pathByGroupId.get(group.id) ?? getWorkdirPathFromSessionGroupId(group.id))
          : undefined
      const createSessionSeed = getCreateSessionSeedForGroup(group.id)
      const canCreateSession = createSessionSeed !== null && agentById.has(createSessionSeed.agentId)
      const canManageAgentGroup = !!agentGroupId && agentById.has(agentGroupId)

      if (!canCreateSession && !workdirPath && !canManageAgentGroup) return null

      return (
        <>
          {canManageAgentGroup && agentGroupId && (
            <Tooltip title={t('common.more')} delay={500}>
              <AgentGroupMoreMenu
                agentId={agentGroupId}
                pinDisabled={isAgentPinActionDisabled}
                pinned={agentPinnedIdSet.has(agentGroupId)}
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
                onClick={() => {
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
      deletingWorkspaceGroupId,
      displayMode,
      getCreateSessionSeedForGroup,
      handleToggleAgentPin,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      t,
      workdirDisplay
    ]
  )

  const getGroupHeaderIcon = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return undefined

      if (displayMode === 'workdir') {
        if (group.id === SESSION_NO_WORKDIR_GROUP_ID) return null
        return <FolderOpen size={13} />
      }

      if (displayMode !== 'agent') return undefined
      if (group.id === SESSION_UNKNOWN_AGENT_GROUP_ID) return null

      const agentId = getAgentIdFromSessionGroupId(group.id)
      const agent = agentId ? agentById.get(agentId) : undefined
      const avatar = agent?.configuration?.avatar?.trim()
      return avatar ? <span className="text-[13px] leading-none">{avatar}</span> : <Bot size={13} />
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

        const actions = resolveAgentGroupActions({
          pinDisabled: isAgentPinActionDisabled,
          pinned: agentPinnedIdSet.has(agentId),
          t
        })

        return (
          <ActionMenu
            actions={actions}
            onAction={(action) => {
              if (action.id === 'agent-group.edit') {
                openAgentEditor(agentId)
                return
              }
              if (action.id === 'agent-group.toggle-pin') {
                void handleToggleAgentPin(agentId)
              }
            }}
          />
        )
      }

      if (displayMode !== 'workdir') return null

      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      const workdirPath = workdirDisplay.pathByGroupId.get(group.id) ?? getWorkdirPathFromSessionGroupId(group.id)
      if (!workdirPath) return null
      const fileManagerName = isMac
        ? t('agent.session.file_manager.finder')
        : isWin
          ? t('agent.session.file_manager.file_explorer')
          : t('agent.session.file_manager.files')

      const actions = resolveWorkdirGroupActions({
        canDelete: !!workspaceId,
        canRename: !!workspaceId,
        deleteDisabled: !!deletingWorkspaceGroupId,
        fileManagerName,
        renameDisabled: isUpdatingWorkspace,
        t
      })

      return (
        <ActionMenu
          actions={actions}
          onAction={(action) => {
            if (action.id === 'workdir-group.open') {
              void handleOpenWorkdirGroup(workdirPath)
              return
            }
            if (action.id === 'workdir-group.rename') {
              handleStartRenameWorkdirGroup(group)
              return
            }
            if (action.id === 'workdir-group.delete') {
              void handleDeleteWorkdirGroup(group)
            }
          }}
        />
      )
    },
    [
      agentById,
      agentPinnedIdSet,
      deletingWorkspaceGroupId,
      displayMode,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      handleToggleAgentPin,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
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
      estimateItemSize={() => 34}
      groupBy={sessionGroupBy}
      collapsedGroupIds={effectiveCollapsedSessionGroupIds}
      revealRequest={revealRequest}
      defaultGroupVisibleCount={5}
      groupLoadStep={5}
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
      onCollapsedGroupIdsChange={handleCollapsedSessionGroupIdsChange}>
      <ResourceList.Header className="gap-1 px-1.5 pb-0">
        <ResourceList.HeaderItem
          type="button"
          aria-label={t('chat.conversation.new')}
          disabled={creatingSession || !headerCreateSessionSeed}
          icon={<SquarePen />}
          label={t('chat.conversation.new')}
          onClick={handleHeaderCreateSession}
          actions={
            <SessionListOptionsMenu
              mode={displayMode}
              onChange={(nextMode) => void setSessionDisplayMode(nextMode)}
              historyLabel={onOpenHistory ? t('history.records.shortTitle') : t('shortcut.general.toggle_sidebar')}
              onOpenHistory={handleOpenHistoryOrToggleSidebar}
            />
          }
        />
      </ResourceList.Header>
      <SessionListBody
        channelTypeMap={channelTypeMap}
        error={listError}
        isDraggable={itemDragReady}
        isValidating={listValidating}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onEditAgent={openAgentEditor}
        onOpenInNewTab={tabs ? openSessionInNewTab : undefined}
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
    </SessionResourceList>
  )
}

interface SessionListBodyProps {
  channelTypeMap: Record<string, string>
  error?: unknown
  isDraggable: boolean
  isValidating: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDeleteSession: (id: string) => Promise<void>
  onEditAgent: (agentId: string) => void
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onRetry: () => Promise<unknown>
  onSelectItem?: () => void
  onTogglePin: (id: string) => Promise<void>
  setActiveSessionId: (id: string | null) => void
}

function SessionListBody({
  channelTypeMap,
  error,
  isDraggable,
  isValidating,
  listRef,
  onDeleteSession,
  onEditAgent,
  onOpenInNewTab,
  onRetry,
  onSelectItem,
  onTogglePin,
  setActiveSessionId
}: SessionListBodyProps) {
  const { t } = useTranslation()

  const renderItem = (session: SessionListItem) => (
    <SessionItem
      key={session.id}
      session={session}
      channelType={channelTypeMap[session.id]}
      pinned={session.pinned}
      onTogglePin={onTogglePin}
      onDelete={onDeleteSession}
      onEditAgent={onEditAgent}
      onOpenInNewTab={onOpenInNewTab}
      onPress={setActiveSessionId}
      onSelectItem={onSelectItem}
    />
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
      renderItem={renderItem}
    />
  )
}

export default memo(Sessions)
