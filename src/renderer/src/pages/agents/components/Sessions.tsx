import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  ResourceList,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  SessionResourceList,
  useResourceList
} from '@renderer/components/chat/resources'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { useCache } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import { useSessions, useUpdateSession } from '@renderer/hooks/agents/useSessionDataApi'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { Bot, Check, ChevronDown, ChevronsUpDown, Clock3, Folder, ListFilter, Plus, Sparkles } from 'lucide-react'
import { memo, type MouseEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem from './SessionItem'
import {
  type AgentSessionDisplayMode,
  applyOptimisticSessionDisplayMove,
  buildSessionDropAnchor,
  canDropSessionItemInDisplayGroup,
  createSessionDisplayGroupResolver,
  createSessionWorkdirLabelMap,
  createSessionWorkdirRankMap,
  getAgentIdFromSessionGroupId,
  getWorkdirPathFromSessionGroupId,
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
}

const logger = loggerService.withContext('AgentSessions')

const SESSION_DISPLAY_OPTIONS: AgentSessionDisplayMode[] = ['time', 'agent', 'workdir']
const SESSION_TODAY_GROUP_ID = 'session:time:today'
const SESSION_DISPLAY_LABEL_KEYS: Record<AgentSessionDisplayMode, string> = {
  agent: 'agent.session.display.agent',
  time: 'agent.session.display.time',
  workdir: 'agent.session.display.workdir'
}

function resolveAgentAvatar(agent: AgentEntity | undefined): string | undefined {
  const avatar = agent?.configuration?.avatar?.trim()
  return avatar || undefined
}

function SessionDisplayModeMenu({
  mode,
  onChange
}: {
  mode: AgentSessionDisplayMode
  onChange: (mode: AgentSessionDisplayMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('agent.session.display.title')}
          className="inline-flex size-5 shrink-0 items-center justify-center p-0 text-muted-foreground/55 leading-none shadow-none hover:bg-transparent hover:text-muted-foreground/75 [&_svg]:block [&_svg]:shrink-0">
          <ListFilter size={12} className="block" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="w-28 rounded-lg border-border/80 p-1 shadow-lg">
        <MenuList className="gap-0.5">
          <div className="px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground/60">
            {t('agent.session.display.title')}
          </div>
          {SESSION_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              label={t(SESSION_DISPLAY_LABEL_KEYS[option])}
              active={mode === option}
              suffix={mode === option ? <Check size={11} /> : null}
              className="h-6 gap-1.5 rounded-md px-1.5 py-0 font-normal text-[11px] text-muted-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground [&_svg]:size-3"
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

export function resolveCreateSessionAgentId(
  sessions: AgentSessionEntity[],
  activeSessionId: string | null,
  agents: AgentEntity[]
): string | null {
  const activeAgentId = sessions.find((s) => s.id === activeSessionId)?.agentId
  return activeAgentId ?? sessions[0]?.agentId ?? agents[0]?.id ?? null
}

const Sessions = ({ onOpenHistory, onSelectItem }: SessionsProps) => {
  const { t } = useTranslation()
  const [groupNow] = useState(() => new Date())
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [collapsedSessionGroupIds, setCollapsedSessionGroupIds] = usePreference('agent.session.collapsed_group_ids')
  const {
    sessions,
    pinIdBySessionId,
    isLoading,
    error,
    deleteSession,
    hasMore,
    isLoadingMore,
    isValidating,
    reload,
    createSession,
    reorderSession,
    togglePin
  } = useSessions(undefined, { loadAll: true, pageSize: 50 })
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const { agents, isLoading: isAgentsLoading, error: agentsError } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)

  const { data: channels } = useQuery('/channels')
  const channelTypeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ch of channels ?? []) {
      if (ch.sessionId) map[ch.sessionId] = ch.type
    }
    return map
  }, [channels])

  const displayMode = sessionDisplayMode ?? 'time'
  const isDraggableMode = displayMode !== 'time'
  const dragReady = isDraggableMode && !hasMore && !isLoadingMore && !isValidating && !isLoading

  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: pinIdBySessionId.has(session.id) })),
    [pinIdBySessionId, sessions]
  )

  const fallbackAgentId = useMemo(
    () => resolveCreateSessionAgentId(sessionItems, activeSessionId, agents),
    [sessionItems, activeSessionId, agents]
  )
  const { updateSession } = useUpdateSession(fallbackAgentId)

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const agentRankById = useMemo(() => new Map(agents.map((agent, index) => [agent.id, index])), [agents])
  const workdirLabelByPath = useMemo(() => createSessionWorkdirLabelMap(sessionItems), [sessionItems])
  const workdirRankByPath = useMemo(() => createSessionWorkdirRankMap(sessionItems), [sessionItems])

  const baseGroupedSessions = useMemo(
    () =>
      sortSessionsForDisplayGroups(sessionItems, {
        agentRankById,
        mode: displayMode,
        now: groupNow,
        workdirRankByPath
      }),
    [agentRankById, displayMode, groupNow, sessionItems, workdirRankByPath]
  )

  const groupedSessions = useMemo(
    () =>
      optimisticMove ? applyOptimisticSessionDisplayMove(baseGroupedSessions, optimisticMove) : baseGroupedSessions,
    [baseGroupedSessions, optimisticMove]
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
        workdirLabelByPath
      }),
    [agentById, displayMode, groupNow, t, workdirLabelByPath]
  )

  const handleCollapsedSessionGroupIdsChange = useCallback(
    (nextGroupIds: string[]) => void setCollapsedSessionGroupIds(nextGroupIds),
    [setCollapsedSessionGroupIds]
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

  const createSessionForGroup = useCallback(
    async (agentId: string | null | undefined, accessiblePaths?: string[]) => {
      if (!agentId || creatingSession) return null

      const agent = agentById.get(agentId)
      if (!agent) return null

      if (!agent.model) {
        window.toast.error(t('error.model.not_exists'))
        return null
      }

      setCreatingSession(true)
      try {
        const created = await createSession({
          agentId,
          name: t('common.unnamed'),
          ...(accessiblePaths && accessiblePaths.length > 0 ? { accessiblePaths } : {})
        })

        if (!created) return null

        setActiveSessionId(created.id)
        return created
      } catch (err) {
        logger.error('Failed to create session from session list', { err, agentId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        return null
      } finally {
        setCreatingSession(false)
      }
    },
    [agentById, createSession, creatingSession, setActiveSessionId, t]
  )

  const handleHeaderCreateSession = useCallback(() => {
    setActiveSessionId(null)
  }, [setActiveSessionId])

  const handleSelectSession = useCallback(
    (id: string | null) => {
      setActiveSessionId(id)
    },
    [setActiveSessionId]
  )

  const canDragSessionItem = useCallback(
    ({ item }: { item: SessionListItem }) => dragReady && !item.pinned,
    [dragReady]
  )

  const canDropSessionItem = useCallback(
    ({ sourceGroupId, targetGroupId }: { sourceGroupId: string; targetGroupId: string }) =>
      dragReady && canDropSessionItemInDisplayGroup({ mode: displayMode, sourceGroupId, targetGroupId }),
    [displayMode, dragReady]
  )

  const handleSessionReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (payload.type !== 'item') return
      if (!dragReady) return
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
    [displayMode, dragReady, reorderSession, sessionItems]
  )

  const getGroupHeaderIcon = useCallback(
    (group: { id: string }, { collapsed }: { collapsed: boolean }) => {
      if (group.id === SESSION_PINNED_GROUP_ID || displayMode === 'time') {
        return <ChevronDown size={14} className={cn('transition-transform', collapsed && '-rotate-90')} />
      }

      if (displayMode === 'agent') {
        if (group.id === SESSION_UNKNOWN_AGENT_GROUP_ID) return <Sparkles size={13} />

        const agentId = getAgentIdFromSessionGroupId(group.id)
        const avatar = resolveAgentAvatar(agentId ? agentById.get(agentId) : undefined)
        return avatar ? <EmojiIcon emoji={avatar} size={16} fontSize={10} className="mr-0" /> : <Bot size={13} />
      }
      if (displayMode === 'workdir') {
        return group.id === SESSION_NO_WORKDIR_GROUP_ID ? (
          <Folder size={13} className="opacity-60" />
        ) : (
          <Folder size={13} />
        )
      }
      return undefined
    },
    [agentById, displayMode]
  )

  const getGroupHeaderAction = useCallback(
    (group: { id: string }) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null

      let payload: { agentId: string | null | undefined; accessiblePaths?: string[] } | null = null
      if (displayMode === 'time') {
        if (group.id !== SESSION_TODAY_GROUP_ID) return null
        payload = { agentId: fallbackAgentId }
      } else if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        if (!agentId || !agentById.has(agentId)) return null
        payload = { agentId }
      } else {
        const path = getWorkdirPathFromSessionGroupId(group.id)
        if (!path) return null
        payload = { agentId: fallbackAgentId, accessiblePaths: [path] }
      }

      if (!payload.agentId) return null

      return (
        <Tooltip title={t('agent.session.add.title')} delay={500}>
          <ResourceList.HeaderActionButton
            type="button"
            aria-label={t('agent.session.add.title')}
            disabled={creatingSession || !agentById.has(payload.agentId)}
            onClick={() => void createSessionForGroup(payload.agentId, payload.accessiblePaths)}>
            <Plus size={12} className="block" />
          </ResourceList.HeaderActionButton>
        </Tooltip>
      )
    },
    [agentById, createSessionForGroup, creatingSession, displayMode, fallbackAgentId, t]
  )

  const listError = error || (displayMode === 'agent' ? agentsError : undefined)
  const listLoading = isLoading || (displayMode === 'agent' && isAgentsLoading)
  const listStatus = listError ? 'error' : listLoading ? 'loading' : groupedSessions.length === 0 ? 'empty' : 'idle'

  return (
    <SessionResourceList<SessionListItem>
      items={groupedSessions}
      status={listStatus}
      selectedId={activeSessionId}
      estimateItemSize={() => 34}
      groupBy={sessionGroupBy}
      collapsedGroupIds={collapsedSessionGroupIds}
      defaultGroupVisibleCount={5}
      groupLoadStep={5}
      getGroupHeaderAction={getGroupHeaderAction}
      getGroupHeaderIcon={getGroupHeaderIcon}
      dragCapabilities={{
        groups: false,
        items: dragReady,
        itemSameGroup: dragReady,
        itemCrossGroup: false
      }}
      canDragItem={canDragSessionItem}
      canDropItem={canDropSessionItem}
      groupShowMoreLabel={t('agent.session.group.show_more')}
      groupCollapseLabel={t('agent.session.group.collapse')}
      onRenameItem={handleRenameSession}
      onReorder={handleSessionReorder}
      onCollapsedGroupIdsChange={handleCollapsedSessionGroupIdsChange}>
      <ResourceList.Header
        icon={<Clock3 size={12} />}
        title={t('agent.session.list.title')}
        count={sessionItems.length}
        className="gap-1 pb-0"
        actions={
          <>
            <SessionDisplayModeMenu mode={displayMode} onChange={(nextMode) => void setSessionDisplayMode(nextMode)} />
            <ResourceList.HeaderActionButton
              type="button"
              aria-label={onOpenHistory ? t('history.v2.agentTitle') : t('shortcut.general.toggle_sidebar')}
              onClick={handleOpenHistoryOrToggleSidebar}>
              <ChevronsUpDown size={12} className="block rotate-45" />
            </ResourceList.HeaderActionButton>
          </>
        }>
        <ResourceList.Search placeholder={t('agent.session.search.placeholder')} />
        <Button
          type="button"
          variant="ghost"
          aria-label={t('agent.session.add.title')}
          disabled={creatingSession}
          className="h-7 w-full justify-start gap-1.5 rounded-md px-2.5 font-normal text-[12px] text-muted-foreground/70 shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground"
          onClick={handleHeaderCreateSession}>
          <Plus size={13} className="block shrink-0" />
          <span className="truncate">{t('agent.session.add.title')}</span>
        </Button>
      </ResourceList.Header>
      <SessionListBody
        channelTypeMap={channelTypeMap}
        error={listError}
        isDraggable={dragReady}
        isValidating={isValidating}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onRetry={reload}
        onSelectItem={onSelectItem}
        onTogglePin={togglePin}
        setActiveSessionId={handleSelectSession}
      />
      {(isLoadingMore || hasMore) && (
        <div className="shrink-0 px-3 py-2 text-center text-[11px] text-muted-foreground/55">{t('common.loading')}</div>
      )}
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
  onRetry,
  onSelectItem,
  onTogglePin,
  setActiveSessionId
}: SessionListBodyProps) {
  const { t } = useTranslation()
  const context = useResourceList<SessionListItem>()

  if (context.state.status === 'loading') {
    return <ResourceList.LoadingState />
  }

  if (context.state.status === 'error') {
    return (
      <ResourceList.ErrorState>
        <div className="flex flex-col gap-2">
          <div className="font-medium text-destructive">{t('agent.session.get.error.failed')}</div>
          <div className="text-muted-foreground">{formatErrorMessage(error)}</div>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => void onRetry()} disabled={isValidating}>
            {t('common.retry')}
          </Button>
        </div>
      </ResourceList.ErrorState>
    )
  }

  if (context.view.items.length === 0) {
    return <ResourceList.EmptyState />
  }

  const renderItem = (session: SessionListItem) => (
    <SessionItem
      key={session.id}
      session={session}
      channelType={channelTypeMap[session.id]}
      pinned={session.pinned}
      onTogglePin={onTogglePin}
      onDelete={onDeleteSession}
      onPress={setActiveSessionId}
      onSelectItem={onSelectItem}
    />
  )

  if (isDraggable) {
    return <ResourceList.VirtualDraggableItems ref={listRef} className="pb-3" renderItem={renderItem} />
  }

  return <ResourceList.VirtualItems ref={listRef} className="pb-3" renderItem={renderItem} />
}

export default memo(Sessions)
