import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { ErrorState } from '@renderer/components/chat'
import {
  ResourceList,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  SessionResourceList,
  useResourceList
} from '@renderer/components/chat/resources'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { AgentSelector } from '@renderer/components/ResourceSelector'
import { useCache } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import { useSessions } from '@renderer/hooks/agents/useSessionDataApi'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { Bot, Check, ChevronDown, ChevronsUpDown, Clock3, Folder, ListFilter, Plus, Sparkles } from 'lucide-react'
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem, { type SessionStreamState } from './SessionItem'
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
          className="inline-flex size-5 shrink-0 items-center justify-center p-0 leading-none text-muted-foreground/55 shadow-none hover:bg-transparent hover:text-muted-foreground/75 [&_svg]:block [&_svg]:shrink-0">
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
              className="h-6 gap-1.5 rounded-md px-1.5 py-0 text-[11px] font-normal text-muted-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground [&_svg]:size-3"
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

const Sessions = ({ onSelectItem }: SessionsProps) => {
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
        await dataApiService.patch(`/sessions/${id}`, { body: { name: trimmedName } })
        await reload()
        window.toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename session', { err, sessionId: id })
        window.toast.error(t('agent.session.update.error.failed'))
      }
    },
    [reload, sessionItems, t]
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
        const created = await dataApiService.post('/sessions', {
          body: {
            agentId,
            name: t('common.unnamed'),
            ...(accessiblePaths && accessiblePaths.length > 0 ? { accessiblePaths } : {})
          }
        })

        setActiveSessionId(created.id)
        await reload()
        return created
      } catch (err) {
        logger.error('Failed to create session from session list', { err, agentId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        return null
      } finally {
        setCreatingSession(false)
      }
    },
    [agentById, creatingSession, reload, setActiveSessionId, t]
  )

  const handleHeaderCreateAgentChange = useCallback(
    (agentId: string | null) => {
      if (!agentId) return
      void createSessionForGroup(agentId)
    },
    [createSessionForGroup]
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

      try {
        await dataApiService.patch(`/sessions/${payload.activeId}/order`, { body: anchor })
        await reload()
      } catch (err) {
        setOptimisticMove(null)
        logger.error('Failed to reorder session', { err, sessionId: payload.activeId })
        window.toast.error(t('agent.session.reorder.error.failed'))
      }
    },
    [displayMode, dragReady, reload, sessionItems, t]
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

  useEffect(() => {
    if (!isLoading && sessionItems.length > 0 && !activeSessionId) {
      setActiveSessionId(sessionItems[0].id)
    }
  }, [isLoading, sessionItems, activeSessionId, setActiveSessionId])

  const listError = error || (displayMode === 'agent' ? agentsError : undefined)
  const listLoading = isLoading || (displayMode === 'agent' && isAgentsLoading)
  const listStatus = listError ? 'error' : listLoading ? 'loading' : groupedSessions.length === 0 ? 'empty' : 'idle'

  if (listError) {
    return (
      <ErrorState
        className="m-2.5"
        title={t('agent.session.get.error.failed')}
        description={formatErrorMessage(listError)}
        action={
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={isValidating}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

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
        actions={
          <>
            <SessionDisplayModeMenu mode={displayMode} onChange={(nextMode) => void setSessionDisplayMode(nextMode)} />
            <AgentSelector
              value={null}
              onChange={handleHeaderCreateAgentChange}
              trigger={
                <ResourceList.HeaderActionButton
                  type="button"
                  aria-label={t('agent.session.add.title')}
                  title={t('agent.session.add.title')}
                  disabled={creatingSession || isAgentsLoading || agents.length === 0}>
                  <Plus size={12} className="block" />
                </ResourceList.HeaderActionButton>
              }
            />
            <ResourceList.HeaderActionButton
              type="button"
              aria-label={t('shortcut.general.toggle_sidebar')}
              onClick={() => void setShowSidebar(!showSidebar)}>
              <ChevronsUpDown size={12} className="block rotate-45" />
            </ResourceList.HeaderActionButton>
          </>
        }>
        <ResourceList.Search placeholder={t('agent.session.search.placeholder')} />
      </ResourceList.Header>
      <SessionListBody
        activeSessionId={activeSessionId}
        channelTypeMap={channelTypeMap}
        isDraggable={dragReady}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onSelectItem={onSelectItem}
        onTogglePin={togglePin}
        setActiveSessionId={setActiveSessionId}
      />
      {(isLoadingMore || hasMore) && (
        <div className="shrink-0 px-3 py-2 text-center text-[11px] text-muted-foreground/55">{t('common.loading')}</div>
      )}
    </SessionResourceList>
  )
}

type SessionStreamStatusSnapshot = {
  signature: string
  value: ReadonlyMap<string, SessionStreamState>
}

const EMPTY_SESSION_STREAM_STATE: SessionStreamState = Object.freeze({
  isFulfilled: false,
  isPending: false
})

const EMPTY_SESSION_STREAM_STATUS_MAP: ReadonlyMap<string, SessionStreamState> = new Map()

const getTopicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as const

const getTopicStreamSeenCacheKey = (topicId: string) => `topic.stream.seen.${topicId}` as const

const buildSessionStreamStatusSnapshot = (sessionIds: readonly string[]): SessionStreamStatusSnapshot => {
  if (sessionIds.length === 0) {
    return {
      signature: '',
      value: EMPTY_SESSION_STREAM_STATUS_MAP
    }
  }

  const value = new Map<string, SessionStreamState>()
  const signatureParts: string[] = []

  for (const sessionId of sessionIds) {
    const topicId = buildAgentSessionTopicId(sessionId)
    const statusEntry = cacheService.getShared(getTopicStreamStatusCacheKey(topicId))
    const seen = cacheService.get(getTopicStreamSeenCacheKey(topicId)) ?? false
    const status = statusEntry?.status
    const streamStatus = {
      isFulfilled: status === 'done' && !seen,
      isPending: status === 'pending' || status === 'streaming'
    }

    signatureParts.push(`${sessionId}:${streamStatus.isPending ? 1 : 0}:${streamStatus.isFulfilled ? 1 : 0}`)

    if (streamStatus.isPending || streamStatus.isFulfilled) {
      value.set(sessionId, streamStatus)
    }
  }

  return {
    signature: signatureParts.join('|'),
    value: value.size > 0 ? value : EMPTY_SESSION_STREAM_STATUS_MAP
  }
}

const subscribeSessionStreamStatuses = (sessionIds: readonly string[], onStoreChange: () => void): (() => void) => {
  if (sessionIds.length === 0) {
    return () => undefined
  }

  const unsubscribes: Array<() => void> = []

  for (const sessionId of new Set(sessionIds)) {
    const topicId = buildAgentSessionTopicId(sessionId)
    unsubscribes.push(cacheService.subscribe(getTopicStreamStatusCacheKey(topicId), onStoreChange))
    unsubscribes.push(cacheService.subscribe(getTopicStreamSeenCacheKey(topicId), onStoreChange))
  }

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
  }
}

const useSessionListStreamStatuses = (sessionIds: readonly string[]): ReadonlyMap<string, SessionStreamState> => {
  const snapshotRef = useRef<SessionStreamStatusSnapshot>({
    signature: '',
    value: EMPTY_SESSION_STREAM_STATUS_MAP
  })

  const getSnapshot = useCallback(() => {
    const nextSnapshot = buildSessionStreamStatusSnapshot(sessionIds)

    if (snapshotRef.current.signature === nextSnapshot.signature) {
      return snapshotRef.current.value
    }

    snapshotRef.current = nextSnapshot
    return nextSnapshot.value
  }, [sessionIds])

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeSessionStreamStatuses(sessionIds, onStoreChange),
    [sessionIds]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

interface SessionListBodyProps {
  activeSessionId: string | null
  channelTypeMap: Record<string, string>
  isDraggable: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDeleteSession: (id: string) => Promise<void>
  onSelectItem?: () => void
  onTogglePin: (id: string) => Promise<void>
  setActiveSessionId: (id: string | null) => void
}

function SessionListBody({
  activeSessionId,
  channelTypeMap,
  isDraggable,
  listRef,
  onDeleteSession,
  onSelectItem,
  onTogglePin,
  setActiveSessionId
}: SessionListBodyProps) {
  const { t } = useTranslation()
  const context = useResourceList<SessionListItem>()
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
  const visibleSessionIds = useMemo(() => context.view.items.map((session) => session.id), [context.view.items])
  const streamStatusBySessionId = useSessionListStreamStatuses(visibleSessionIds)
  const renamingTopicIds = useMemo(() => new Set(renamingTopics), [renamingTopics])
  const newlyRenamedTopicIds = useMemo(() => new Set(newlyRenamedTopics), [newlyRenamedTopics])

  useEffect(() => {
    if (!activeSessionId) return
    const streamStatus = streamStatusBySessionId.get(activeSessionId)
    if (streamStatus?.isFulfilled !== true) return
    cacheService.set(getTopicStreamSeenCacheKey(buildAgentSessionTopicId(activeSessionId)), true)
  }, [activeSessionId, streamStatusBySessionId])

  if (context.state.status === 'loading') {
    return <ResourceList.LoadingState />
  }

  if (context.state.status === 'error') {
    return <ResourceList.ErrorState message={t('error.boundary.default.message')} />
  }

  if (context.view.items.length === 0) {
    return <ResourceList.EmptyState />
  }

  const renderItem = (session: SessionListItem) => (
    <SessionItem
      key={session.id}
      session={session}
      channelType={channelTypeMap[session.id]}
      isNewlyRenamed={newlyRenamedTopicIds.has(buildAgentSessionTopicId(session.id))}
      isRenaming={renamingTopicIds.has(buildAgentSessionTopicId(session.id))}
      pinned={session.pinned}
      streamStatus={streamStatusBySessionId.get(session.id) ?? EMPTY_SESSION_STREAM_STATE}
      onTogglePin={() => void onTogglePin(session.id)}
      onDelete={() => void onDeleteSession(session.id)}
      onPress={() => {
        setActiveSessionId(session.id)
        onSelectItem?.()
      }}
    />
  )

  if (isDraggable) {
    return <ResourceList.VirtualDraggableItems ref={listRef} className="pb-3" renderItem={renderItem} />
  }

  return <ResourceList.VirtualItems ref={listRef} className="pb-3" renderItem={renderItem} />
}

export default memo(Sessions)
