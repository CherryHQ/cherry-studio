import {
  buildResourceListGroupDropAnchor,
  buildResourceListItemDropAnchor,
  compareResourceOrderKey,
  composeResourceListGroupResolvers,
  createPinnedGroupResolver,
  createTimeGroupResolver,
  getResourceTimeBucket,
  moveResourceListStringGroupAfterDrop,
  type ResourceListGroup,
  type ResourceListGroupReorderPayload,
  type ResourceListGroupResolver,
  type ResourceListItemReorderPayload,
  type ResourceListTimeBucket,
  withResourceListGroupIdPrefix
} from '@renderer/components/chat/resources'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentSessionDisplayMode as PreferenceAgentSessionDisplayMode } from '@shared/data/preference/preferenceTypes'

export type AgentSessionDisplayMode = PreferenceAgentSessionDisplayMode

export type SessionDisplayAgent = {
  id: string
  name: string
}

export type SessionDisplayGroupLabels = {
  pinned: string
  time: Record<ResourceListTimeBucket, string>
  agent: {
    unknown: string
  }
  workdir: {
    none: string
  }
}

export type SessionDisplayGroupOptions = {
  agentById?: ReadonlyMap<string, SessionDisplayAgent>
  labels: SessionDisplayGroupLabels
  mode: AgentSessionDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
  pinnedAsSection?: boolean
  workdirDisplay?: SessionWorkdirDisplayMaps
}

export type SessionDisplaySortOptions = {
  agentRankById?: ReadonlyMap<string, number>
  mode: AgentSessionDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
  workdirDisplay?: Pick<SessionWorkdirDisplayMaps, 'groupIdByPath' | 'groupIdByWorkspaceId' | 'rankByGroupId'>
}

export type SessionListItem = AgentSessionEntity & {
  pinned?: boolean
}

type SessionWorkdirSource = Pick<AgentSessionEntity, 'workspace' | 'workspaceId'>
type WorkspaceDisplaySource = Pick<AgentWorkspaceEntity, 'id' | 'name' | 'path' | 'type'>

export type SessionWorkdirDisplayMaps = {
  groupIdByPath: ReadonlyMap<string, string>
  groupIdByWorkspaceId: ReadonlyMap<string, string>
  labelByGroupId: ReadonlyMap<string, string>
  pathByGroupId: ReadonlyMap<string, string>
  rankByGroupId: ReadonlyMap<string, number>
  workspaceIdByGroupId: ReadonlyMap<string, string>
}

const SESSION_TIME_BUCKET_RANK: Record<ResourceListTimeBucket, number> = {
  today: 1,
  yesterday: 2,
  'this-week': 3,
  earlier: 4
}

export const SESSION_PINNED_GROUP_ID = 'session:pinned'
export const SESSION_PINNED_SECTION_ID = 'session:section:pinned'
export const SESSION_AGENT_SECTION_ID = 'session:section:agent'
export const SESSION_WORKDIR_SECTION_ID = 'session:section:workdir'
export const SESSION_NO_PROJECT_GROUP_ID = 'session:no-project'
export const SESSION_NO_PROJECT_SECTION_ID = 'session:section:no-project'
export const SESSION_UNKNOWN_AGENT_GROUP_ID = 'session:agent:unknown'
export const SESSION_NO_WORKDIR_GROUP_ID = 'session:workdir:none'

const SESSION_AGENT_GROUP_ID_PREFIX = 'session:agent:'
const SESSION_WORKSPACE_GROUP_ID_PREFIX = 'session:workspace:'
const SESSION_WORKDIR_GROUP_ID_PREFIX = 'session:workdir:'
const NO_PROJECT_GROUP_RANK = Number.MAX_SAFE_INTEGER
const UNKNOWN_GROUP_RANK = Number.MAX_SAFE_INTEGER - 1

function withSessionGroupIdPrefix<T>(resolver: ResourceListGroupResolver<T>): ResourceListGroupResolver<T> {
  return withResourceListGroupIdPrefix('session:', resolver)
}

function getSessionAgentGroupId(agentId: string) {
  return `${SESSION_AGENT_GROUP_ID_PREFIX}${agentId}`
}

export function getAgentIdFromSessionGroupId(groupId: string): string | undefined {
  if (groupId === SESSION_UNKNOWN_AGENT_GROUP_ID || !groupId.startsWith(SESSION_AGENT_GROUP_ID_PREFIX)) return undefined
  return groupId.slice(SESSION_AGENT_GROUP_ID_PREFIX.length)
}

export function getWorkdirPathFromSessionGroupId(groupId: string): string | undefined {
  if (groupId === SESSION_NO_WORKDIR_GROUP_ID || !groupId.startsWith(SESSION_WORKDIR_GROUP_ID_PREFIX)) return undefined
  return decodeURIComponent(groupId.slice(SESSION_WORKDIR_GROUP_ID_PREFIX.length))
}

export function getWorkspaceIdFromSessionGroupId(groupId: string): string | undefined {
  if (!groupId.startsWith(SESSION_WORKSPACE_GROUP_ID_PREFIX)) return undefined
  return decodeURIComponent(groupId.slice(SESSION_WORKSPACE_GROUP_ID_PREFIX.length))
}

export function getWorkspaceSessionGroupId(workspaceId: string): string {
  return `${SESSION_WORKSPACE_GROUP_ID_PREFIX}${encodeURIComponent(workspaceId)}`
}

export function getFallbackWorkdirSessionGroupId(path: string): string {
  return `${SESSION_WORKDIR_GROUP_ID_PREFIX}${encodeURIComponent(path)}`
}

export function normalizeSessionWorkdirPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim()
  if (!trimmed) return null
  return trimmed.replace(/[\\/]+$/, '') || trimmed
}

export function isSystemWorkspaceSession(session: SessionWorkdirSource): boolean {
  return session.workspace?.type === 'system'
}

export function getPrimarySessionWorkdir(session: SessionWorkdirSource): string | null {
  if (isSystemWorkspaceSession(session)) return null
  return normalizeSessionWorkdirPath(session.workspace?.path)
}

function getPathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

export function getSessionWorkdirFallbackLabel(path: string): string {
  const segments = getPathSegments(path)
  return segments.at(-1) ?? path
}

function getKnownSessionWorkspaceGroupId(
  session: SessionWorkdirSource,
  groupIdByWorkspaceId: ReadonlyMap<string, string>,
  groupIdByPath: ReadonlyMap<string, string>
) {
  if (session.workspaceId) {
    const groupId = groupIdByWorkspaceId.get(session.workspaceId)
    if (groupId) return groupId
  }

  const path = getPrimarySessionWorkdir(session)
  return path ? groupIdByPath.get(path) : undefined
}

export function getSessionWorkdirGroupId(
  session: SessionWorkdirSource,
  display?: Pick<SessionWorkdirDisplayMaps, 'groupIdByPath' | 'groupIdByWorkspaceId'>
): string {
  const knownGroupId = display
    ? getKnownSessionWorkspaceGroupId(session, display.groupIdByWorkspaceId, display.groupIdByPath)
    : undefined
  if (knownGroupId) return knownGroupId

  const path = getPrimarySessionWorkdir(session)
  return path ? getFallbackWorkdirSessionGroupId(path) : SESSION_NO_WORKDIR_GROUP_ID
}

function getUniqueSessionFallbackWorkdirPaths(
  sessions: readonly SessionWorkdirSource[],
  groupIdByWorkspaceId: ReadonlyMap<string, string>,
  groupIdByPath: ReadonlyMap<string, string>
) {
  return Array.from(
    new Set(
      sessions
        .filter((session) => !getKnownSessionWorkspaceGroupId(session, groupIdByWorkspaceId, groupIdByPath))
        .map(getPrimarySessionWorkdir)
        .filter((path): path is string => typeof path === 'string')
    )
  )
}

function createFallbackWorkdirLabelEntries(paths: readonly string[]) {
  const basenameCounts = new Map<string, number>()

  for (const path of paths) {
    const basename = getSessionWorkdirFallbackLabel(path)
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1)
  }

  return paths.map((path) => {
    const segments = getPathSegments(path)
    const basename = segments.at(-1) ?? path
    if ((basenameCounts.get(basename) ?? 0) <= 1) {
      return [path, basename] as const
    }

    const parent = segments.at(-2)
    return [path, parent ? `${parent}/${basename}` : path] as const
  })
}

export function createSessionWorkdirDisplayMaps(
  sessions: readonly SessionWorkdirSource[],
  workspaces: readonly WorkspaceDisplaySource[] = []
): SessionWorkdirDisplayMaps {
  const groupIdByPath = new Map<string, string>()
  const groupIdByWorkspaceId = new Map<string, string>()
  const labelByGroupId = new Map<string, string>()
  const pathByGroupId = new Map<string, string>()
  const rankByGroupId = new Map<string, number>()
  const workspaceIdByGroupId = new Map<string, string>()
  const referencedWorkspaceIds = new Set(
    sessions
      .map((session) => session.workspaceId)
      .filter((workspaceId): workspaceId is string => typeof workspaceId === 'string' && workspaceId.length > 0)
  )
  const referencedWorkspacePaths = new Set(
    sessions.map(getPrimarySessionWorkdir).filter((path): path is string => typeof path === 'string')
  )

  for (const workspace of workspaces) {
    if (workspace.type === 'system') continue
    const path = normalizeSessionWorkdirPath(workspace.path)
    if (!path || groupIdByWorkspaceId.has(workspace.id)) continue
    if (!referencedWorkspaceIds.has(workspace.id) && !referencedWorkspacePaths.has(path)) continue

    const groupId = getWorkspaceSessionGroupId(workspace.id)

    groupIdByWorkspaceId.set(workspace.id, groupId)
    if (!groupIdByPath.has(path)) {
      groupIdByPath.set(path, groupId)
    }
    labelByGroupId.set(groupId, workspace.name.trim() || getSessionWorkdirFallbackLabel(path))
    pathByGroupId.set(groupId, path)
    workspaceIdByGroupId.set(groupId, workspace.id)
    rankByGroupId.set(groupId, rankByGroupId.size)
  }

  for (const [path, label] of createFallbackWorkdirLabelEntries(
    getUniqueSessionFallbackWorkdirPaths(sessions, groupIdByWorkspaceId, groupIdByPath)
  )) {
    const groupId = getFallbackWorkdirSessionGroupId(path)
    if (labelByGroupId.has(groupId)) continue

    groupIdByPath.set(path, groupId)
    labelByGroupId.set(groupId, label)
    pathByGroupId.set(groupId, path)
    rankByGroupId.set(groupId, rankByGroupId.size)
  }

  return { groupIdByPath, groupIdByWorkspaceId, labelByGroupId, pathByGroupId, rankByGroupId, workspaceIdByGroupId }
}

export function createSessionWorkdirLabelMap(
  sessions: readonly SessionWorkdirSource[],
  workspaces: readonly WorkspaceDisplaySource[] = []
) {
  return createSessionWorkdirDisplayMaps(sessions, workspaces).labelByGroupId
}

export function createSessionWorkdirRankMap(
  sessions: readonly SessionWorkdirSource[],
  workspaces: readonly WorkspaceDisplaySource[] = []
) {
  return createSessionWorkdirDisplayMaps(sessions, workspaces).rankByGroupId
}

export function createSessionDisplayGroupResolver<T extends SessionListItem>({
  agentById,
  labels,
  mode,
  now,
  pinnedAsSection = false,
  workdirDisplay
}: SessionDisplayGroupOptions): ResourceListGroupResolver<T> {
  const pinnedGroupLabel = mode === 'time' || !pinnedAsSection ? labels.pinned : ''

  if (mode === 'time') {
    const pinnedResolver = createPinnedGroupResolver<T>({
      isPinned: (session) => session.pinned === true,
      group: { id: 'pinned', label: pinnedGroupLabel } satisfies ResourceListGroup
    })

    return withSessionGroupIdPrefix(
      composeResourceListGroupResolvers(
        pinnedResolver,
        createTimeGroupResolver<T>({
          getTimestamp: (session) => session.updatedAt,
          labels: labels.time,
          now
        })
      )
    )
  }

  if (mode === 'agent') {
    const pinnedResolver = createPinnedGroupResolver<T>({
      isPinned: (session) => session.pinned === true,
      group: { id: SESSION_PINNED_GROUP_ID, label: pinnedGroupLabel } satisfies ResourceListGroup
    })

    return composeResourceListGroupResolvers(pinnedResolver, (session) => {
      const agentId = session.agentId
      if (!agentId) {
        return { id: SESSION_UNKNOWN_AGENT_GROUP_ID, label: labels.agent.unknown }
      }

      const agent = agentById?.get(agentId)
      return agent
        ? { id: getSessionAgentGroupId(agent.id), label: agent.name }
        : { id: SESSION_UNKNOWN_AGENT_GROUP_ID, label: labels.agent.unknown }
    })
  }

  const pinnedResolver = createPinnedGroupResolver<T>({
    isPinned: (session) => session.pinned === true,
    group: { id: SESSION_PINNED_GROUP_ID, label: pinnedGroupLabel } satisfies ResourceListGroup
  })

  return composeResourceListGroupResolvers(pinnedResolver, (session) => {
    if (isSystemWorkspaceSession(session)) {
      return { id: SESSION_NO_PROJECT_GROUP_ID, label: '' }
    }

    const groupId = getSessionWorkdirGroupId(session, workdirDisplay)
    if (groupId === SESSION_NO_WORKDIR_GROUP_ID) {
      return { id: SESSION_NO_WORKDIR_GROUP_ID, label: labels.workdir.none }
    }

    const path = getPrimarySessionWorkdir(session)
    return {
      id: groupId,
      label: workdirDisplay?.labelByGroupId.get(groupId) ?? (path ? getSessionWorkdirFallbackLabel(path) : groupId)
    }
  })
}

function getWorkdirGroupRank(
  session: SessionWorkdirSource,
  workdirDisplay?: Pick<SessionWorkdirDisplayMaps, 'groupIdByPath' | 'groupIdByWorkspaceId' | 'rankByGroupId'>
) {
  if (isSystemWorkspaceSession(session)) return NO_PROJECT_GROUP_RANK

  const groupId = getSessionWorkdirGroupId(session, workdirDisplay)
  if (groupId === SESSION_NO_WORKDIR_GROUP_ID) return UNKNOWN_GROUP_RANK
  return workdirDisplay?.rankByGroupId.get(groupId) ?? UNKNOWN_GROUP_RANK
}

function getAgentGroupRank(session: Pick<AgentSessionEntity, 'agentId'>, agentRankById?: ReadonlyMap<string, number>) {
  if (!session.agentId) return UNKNOWN_GROUP_RANK
  return agentRankById?.get(session.agentId) ?? UNKNOWN_GROUP_RANK
}

export function sortSessionsForDisplayGroups<T extends SessionListItem>(
  sessions: readonly T[],
  options: SessionDisplaySortOptions
): T[] {
  if (options.mode === 'time') {
    return sessions
      .map((session, index) => ({
        session,
        index,
        rank:
          session.pinned === true ? 0 : SESSION_TIME_BUCKET_RANK[getResourceTimeBucket(session.updatedAt, options.now)],
        updatedAtMs: Date.parse(session.updatedAt)
      }))
      .sort((a, b) => {
        const rankDelta = a.rank - b.rank
        if (rankDelta !== 0) return rankDelta
        if (a.session.pinned === true || b.session.pinned === true) return a.index - b.index
        if (Number.isFinite(a.updatedAtMs) && Number.isFinite(b.updatedAtMs)) {
          return b.updatedAtMs - a.updatedAtMs || a.index - b.index
        }
        return a.index - b.index
      })
      .map(({ session }) => session)
  }

  return sessions
    .map((session, index) => {
      let displayRank: number
      if (options.mode === 'workdir' && isSystemWorkspaceSession(session)) {
        displayRank = NO_PROJECT_GROUP_RANK
      } else if (options.mode === 'agent') {
        displayRank = getAgentGroupRank(session, options.agentRankById)
      } else {
        displayRank = getWorkdirGroupRank(session, options.workdirDisplay)
      }

      return {
        session,
        index,
        rank: session.pinned === true ? 0 : displayRank >= UNKNOWN_GROUP_RANK ? displayRank : displayRank + 1
      }
    })
    .sort((a, b) => {
      const rankDelta = a.rank - b.rank
      if (rankDelta !== 0) return rankDelta
      if (a.session.pinned === true || b.session.pinned === true) return a.index - b.index
      return compareResourceOrderKey(a.session.orderKey, b.session.orderKey) || a.index - b.index
    })
    .map(({ session }) => session)
}

export function normalizeSessionDropPayload(payload: ResourceListItemReorderPayload): ResourceListItemReorderPayload {
  return payload
}

export function buildSessionDropAnchor(payload: ResourceListItemReorderPayload): OrderRequest {
  return buildResourceListItemDropAnchor(payload)
}

export function buildSessionWorkdirGroupDropAnchor(
  payload: ResourceListGroupReorderPayload,
  overWorkspaceId: string
): OrderRequest {
  return buildResourceListGroupDropAnchor(payload, overWorkspaceId)
}

export function buildSessionAgentGroupDropAnchor(
  payload: ResourceListGroupReorderPayload,
  overAgentId: string
): OrderRequest {
  return buildResourceListGroupDropAnchor(payload, overAgentId)
}

export function canDropSessionItemInDisplayGroup({
  mode,
  sourceGroupId,
  targetGroupId
}: {
  mode: AgentSessionDisplayMode
  sourceGroupId: string
  targetGroupId: string
}) {
  return mode !== 'time' && sourceGroupId === targetGroupId && targetGroupId !== SESSION_PINNED_GROUP_ID
}

export function applyOptimisticSessionDisplayMove<T extends SessionListItem>(
  sessions: readonly T[],
  payload: ResourceListItemReorderPayload
): T[] {
  const activeIndex = sessions.findIndex((session) => session.id === payload.activeId)
  if (activeIndex < 0) return [...sessions]

  const next = sessions.filter((session) => session.id !== payload.activeId)
  let insertIndex = next.length

  if (payload.overType === 'item') {
    const overIndex = next.findIndex((session) => session.id === payload.overId)
    if (overIndex >= 0) {
      insertIndex = payload.position === 'before' ? overIndex : overIndex + 1
    }
  }

  next.splice(insertIndex, 0, sessions[activeIndex])
  return next
}

export function moveSessionWorkdirGroupAfterDrop<T extends { id: string }>(
  workspaces: readonly T[],
  activeWorkspaceId: string,
  overWorkspaceId: string,
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>
): T[] {
  const activeIndex = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId)
  const overIndex = workspaces.findIndex((workspace) => workspace.id === overWorkspaceId)

  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return [...workspaces]
  }

  const next = workspaces.filter((workspace) => workspace.id !== activeWorkspaceId)
  const adjustedOverIndex = next.findIndex((workspace) => workspace.id === overWorkspaceId)
  const insertIndex = payload.sourceIndex < payload.targetIndex ? adjustedOverIndex + 1 : adjustedOverIndex
  next.splice(insertIndex, 0, workspaces[activeIndex])

  return next
}

export function moveSessionAgentGroupAfterDrop(
  agentIds: readonly string[],
  activeAgentId: string,
  overAgentId: string,
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>
): string[] {
  return moveResourceListStringGroupAfterDrop(agentIds, activeAgentId, overAgentId, payload)
}
