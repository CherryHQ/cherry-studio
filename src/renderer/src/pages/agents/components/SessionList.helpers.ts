import {
  composeResourceListGroupResolvers,
  createPinnedGroupResolver,
  createTimeGroupResolver,
  getResourceTimeBucket,
  type ResourceListGroup,
  type ResourceListGroupResolver,
  type ResourceListItemReorderPayload,
  type ResourceListTimeBucket,
  sortByResourceGroupRank
} from '@renderer/components/chat/resources'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
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
  workdirLabelByPath?: ReadonlyMap<string, string>
}

export type SessionDisplaySortOptions = {
  agentRankById?: ReadonlyMap<string, number>
  mode: AgentSessionDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
  workdirRankByPath?: ReadonlyMap<string, number>
}

export type SessionListItem = AgentSessionEntity & {
  pinned?: boolean
}

const SESSION_TIME_BUCKET_RANK: Record<ResourceListTimeBucket, number> = {
  today: 1,
  yesterday: 2,
  'this-week': 3,
  earlier: 4
}

export const SESSION_PINNED_GROUP_ID = 'session:pinned'
export const SESSION_UNKNOWN_AGENT_GROUP_ID = 'session:agent:unknown'
export const SESSION_NO_WORKDIR_GROUP_ID = 'session:workdir:none'

const SESSION_AGENT_GROUP_ID_PREFIX = 'session:agent:'
const SESSION_WORKDIR_GROUP_ID_PREFIX = 'session:workdir:'
const UNKNOWN_GROUP_RANK = Number.MAX_SAFE_INTEGER

function withSessionGroupIdPrefix<T>(resolver: ResourceListGroupResolver<T>): ResourceListGroupResolver<T> {
  return (item) => {
    const group = resolver(item)
    if (!group) return null
    return { ...group, id: `session:${group.id}` }
  }
}

export function getSessionAgentGroupId(agentId: string) {
  return `${SESSION_AGENT_GROUP_ID_PREFIX}${agentId}`
}

export function getAgentIdFromSessionGroupId(groupId: string): string | undefined {
  if (groupId === SESSION_UNKNOWN_AGENT_GROUP_ID || !groupId.startsWith(SESSION_AGENT_GROUP_ID_PREFIX)) return undefined
  return groupId.slice(SESSION_AGENT_GROUP_ID_PREFIX.length)
}

export function getSessionWorkdirGroupId(path: string) {
  return `${SESSION_WORKDIR_GROUP_ID_PREFIX}${encodeURIComponent(path)}`
}

export function getWorkdirPathFromSessionGroupId(groupId: string): string | undefined {
  if (groupId === SESSION_NO_WORKDIR_GROUP_ID || !groupId.startsWith(SESSION_WORKDIR_GROUP_ID_PREFIX)) return undefined
  return decodeURIComponent(groupId.slice(SESSION_WORKDIR_GROUP_ID_PREFIX.length))
}

export function normalizeSessionWorkdirPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim()
  if (!trimmed) return null
  return trimmed.replace(/[\\/]+$/, '') || trimmed
}

export function getPrimarySessionWorkdir(session: Pick<AgentSessionEntity, 'accessiblePaths'>): string | null {
  return normalizeSessionWorkdirPath(session.accessiblePaths?.[0])
}

function getPathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

export function getSessionWorkdirFallbackLabel(path: string): string {
  const segments = getPathSegments(path)
  return segments.at(-1) ?? path
}

export function createSessionWorkdirLabelMap(sessions: readonly Pick<AgentSessionEntity, 'accessiblePaths'>[]) {
  const paths = Array.from(
    new Set(sessions.map(getPrimarySessionWorkdir).filter((path): path is string => typeof path === 'string'))
  )
  const basenameCounts = new Map<string, number>()

  for (const path of paths) {
    const basename = getSessionWorkdirFallbackLabel(path)
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1)
  }

  return new Map(
    paths.map((path) => {
      const segments = getPathSegments(path)
      const basename = segments.at(-1) ?? path
      if ((basenameCounts.get(basename) ?? 0) <= 1) {
        return [path, basename] as const
      }

      const parent = segments.at(-2)
      return [path, parent ? `${parent}/${basename}` : path] as const
    })
  )
}

export function createSessionWorkdirRankMap(sessions: readonly Pick<AgentSessionEntity, 'accessiblePaths'>[]) {
  const rankByPath = new Map<string, number>()

  for (const session of sessions) {
    const path = getPrimarySessionWorkdir(session)
    if (!path || rankByPath.has(path)) continue
    rankByPath.set(path, rankByPath.size)
  }

  return rankByPath
}

export function createSessionDisplayGroupResolver<T extends SessionListItem>({
  agentById,
  labels,
  mode,
  now,
  workdirLabelByPath
}: SessionDisplayGroupOptions): ResourceListGroupResolver<T> {
  const pinnedResolver = createPinnedGroupResolver<T>({
    isPinned: (session) => session.pinned === true,
    group: { id: 'pinned', label: labels.pinned } satisfies ResourceListGroup
  })

  if (mode === 'time') {
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
    return withSessionGroupIdPrefix(
      composeResourceListGroupResolvers(pinnedResolver, (session) => {
        const agentId = session.agentId
        if (!agentId) {
          return { id: 'agent:unknown', label: labels.agent.unknown }
        }

        const agent = agentById?.get(agentId)
        return agent
          ? { id: `agent:${agent.id}`, label: agent.name }
          : { id: 'agent:unknown', label: labels.agent.unknown }
      })
    )
  }

  return withSessionGroupIdPrefix(
    composeResourceListGroupResolvers(pinnedResolver, (session) => {
      const path = getPrimarySessionWorkdir(session)
      if (!path) {
        return { id: 'workdir:none', label: labels.workdir.none }
      }

      return {
        id: `workdir:${encodeURIComponent(path)}`,
        label: workdirLabelByPath?.get(path) ?? getSessionWorkdirFallbackLabel(path)
      }
    })
  )
}

function compareOrderKey(a?: string, b?: string) {
  if (a && b) {
    if (a < b) return -1
    if (a > b) return 1
  }

  return 0
}

function compareUpdatedAtDesc(a: string, b: string) {
  const aTime = Date.parse(a)
  const bTime = Date.parse(b)

  if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
    return bTime - aTime
  }

  return 0
}

function getAgentGroupRank(session: Pick<AgentSessionEntity, 'agentId'>, agentRankById?: ReadonlyMap<string, number>) {
  if (!session.agentId) return UNKNOWN_GROUP_RANK
  return agentRankById?.get(session.agentId) ?? UNKNOWN_GROUP_RANK
}

function getWorkdirGroupRank(
  session: Pick<AgentSessionEntity, 'accessiblePaths'>,
  workdirRankByPath?: ReadonlyMap<string, number>
) {
  const path = getPrimarySessionWorkdir(session)
  if (!path) return UNKNOWN_GROUP_RANK
  return workdirRankByPath?.get(path) ?? UNKNOWN_GROUP_RANK
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
          session.pinned === true ? 0 : SESSION_TIME_BUCKET_RANK[getResourceTimeBucket(session.updatedAt, options.now)]
      }))
      .sort((a, b) => {
        const rankDelta = a.rank - b.rank
        if (rankDelta !== 0) return rankDelta
        if (a.session.pinned === true || b.session.pinned === true) return a.index - b.index
        return compareUpdatedAtDesc(a.session.updatedAt, b.session.updatedAt) || a.index - b.index
      })
      .map(({ session }) => session)
  }

  return sortByResourceGroupRank(sessions, (session) => {
    if (session.pinned === true) return 0
    if (options.mode === 'agent') return getAgentGroupRank(session, options.agentRankById) + 1
    return getWorkdirGroupRank(session, options.workdirRankByPath) + 1
  }).sort((a, b) => {
    if (a.pinned === true || b.pinned === true) return 0

    const aRank =
      options.mode === 'agent'
        ? getAgentGroupRank(a, options.agentRankById)
        : getWorkdirGroupRank(a, options.workdirRankByPath)
    const bRank =
      options.mode === 'agent'
        ? getAgentGroupRank(b, options.agentRankById)
        : getWorkdirGroupRank(b, options.workdirRankByPath)
    const rankDelta = aRank - bRank
    if (rankDelta !== 0) return rankDelta

    return compareOrderKey(a.orderKey, b.orderKey)
  })
}

export function normalizeSessionDropPayload(payload: ResourceListItemReorderPayload): ResourceListItemReorderPayload {
  if (
    payload.type !== 'item' ||
    payload.overType !== 'item' ||
    payload.sourceGroupId !== payload.targetGroupId ||
    payload.sourceIndex === payload.targetIndex
  ) {
    return payload
  }

  const position = payload.sourceIndex < payload.targetIndex ? 'after' : 'before'
  return payload.position === position ? payload : { ...payload, position }
}

export function buildSessionDropAnchor(payload: ResourceListItemReorderPayload): OrderRequest {
  if (payload.overType === 'item') {
    return payload.position === 'before' ? { before: payload.overId } : { after: payload.overId }
  }

  return { position: 'last' }
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
