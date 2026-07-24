import { usePersistCache, useSharedCacheSelector, useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import type {
  AgentSessionContextUsageSnapshotStore,
  AgentSessionContextUsageSummary
} from '@shared/data/cache/cacheValueTypes'
import { useCallback, useEffect, useMemo } from 'react'

const EMPTY_SESSION_ID = '__none__'
const SESSION_ID_SEPARATOR = '\u0000'
const MAX_CONTEXT_USAGE_SNAPSHOTS = 100
const EMPTY_CONTEXT_USAGE_SNAPSHOTS = new Map<string, AgentSessionContextUsageSummary>()

export const AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY = 'ui.agent.context_usage_snapshots' as const

interface AgentSessionContextUsageState {
  usage: AgentSessionContextUsageSummary | null
  percentage: number | null
}

export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  expectedModels?: readonly (string | null | undefined)[]
): AgentSessionContextUsageState {
  const cachedUsage = useSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  const [persistedSnapshots] = usePersistCache(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY)
  const sessionUsage = sessionId ? (cachedUsage ?? persistedSnapshots[sessionId] ?? null) : null
  const effectiveUsage = sessionId && isExpectedModelUsage(sessionUsage, expectedModels) ? sessionUsage : null
  const percentage =
    effectiveUsage?.percentage === undefined ? null : Math.round(Math.min(100, Math.max(0, effectiveUsage.percentage)))

  return { usage: effectiveUsage, percentage }
}

/**
 * Captures live runtime usage for every known session into renderer Persist.
 * This is intentionally best-effort UI state: headless sessions with no mounted
 * renderer are not observed, and page entry never opens/recounts a runtime.
 */
export function usePersistAgentSessionContextUsageSnapshots(sessionIds: readonly string[]): void {
  const [, setPersistedSnapshots] = usePersistCache(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY)
  const sessionIdsKey = useMemo(() => Array.from(new Set(sessionIds)).sort().join(SESSION_ID_SEPARATOR), [sessionIds])
  const uniqueSessionIds = useMemo(
    () => (sessionIdsKey ? sessionIdsKey.split(SESSION_ID_SEPARATOR) : []),
    [sessionIdsKey]
  )
  const selectUsageSnapshots = useCallback(
    (values: readonly (AgentSessionContextUsageSummary | null | undefined)[]) => {
      const entries: Array<[string, AgentSessionContextUsageSummary]> = []
      uniqueSessionIds.forEach((sessionId, index) => {
        const usage = values[index]
        if (usage) entries.push([sessionId, usage])
      })

      return entries.length ? new Map(entries) : EMPTY_CONTEXT_USAGE_SNAPSHOTS
    },
    [uniqueSessionIds]
  )
  const liveSnapshots = useSharedCacheSelector(
    uniqueSessionIds.map(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY),
    selectUsageSnapshots,
    areContextUsageSnapshotMapsEqual
  )

  useEffect(() => {
    if (liveSnapshots.size === 0) return
    setPersistedSnapshots((current) => mergeContextUsageSnapshots(current, liveSnapshots))
  }, [liveSnapshots, setPersistedSnapshots])
}

function isExpectedModelUsage(
  usage: AgentSessionContextUsageSummary | null,
  expectedModels: readonly (string | null | undefined)[] | undefined
): boolean {
  if (!usage) return true
  const expected = expectedModels?.map(normalizeModelId).filter((model): model is string => Boolean(model))
  if (!expected?.length) return true

  const actual = normalizeModelId(usage.model)
  return Boolean(actual && expected.includes(actual))
}

function normalizeModelId(model: string | null | undefined): string | undefined {
  const normalized = model
    ?.trim()
    .replace(/\[1m\]$/i, '')
    .toLowerCase()
  return normalized || undefined
}

function areContextUsageSnapshotMapsEqual(
  a: ReadonlyMap<string, AgentSessionContextUsageSummary>,
  b: ReadonlyMap<string, AgentSessionContextUsageSummary>
): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [sessionId, usage] of a) {
    const other = b.get(sessionId)
    if (!other || !areContextUsageSnapshotsEqual(usage, other)) return false
  }
  return true
}

function areContextUsageSnapshotsEqual(
  a: AgentSessionContextUsageSummary,
  b: AgentSessionContextUsageSummary
): boolean {
  return (
    a.totalTokens === b.totalTokens &&
    a.maxTokens === b.maxTokens &&
    a.percentage === b.percentage &&
    a.model === b.model &&
    a.categories.length === b.categories.length &&
    a.categories.every(
      (category, index) =>
        category.name === b.categories[index]?.name && category.tokens === b.categories[index]?.tokens
    )
  )
}

function mergeContextUsageSnapshots(
  current: Readonly<AgentSessionContextUsageSnapshotStore>,
  liveSnapshots: ReadonlyMap<string, AgentSessionContextUsageSummary>
): AgentSessionContextUsageSnapshotStore {
  const entries = Object.entries(current)
  let changed = false

  for (const [sessionId, usage] of liveSnapshots) {
    const existingIndex = entries.findIndex(([existingSessionId]) => existingSessionId === sessionId)
    const existing = existingIndex >= 0 ? entries[existingIndex][1] : undefined
    if (existing && areContextUsageSnapshotsEqual(existing, usage)) continue

    if (existingIndex >= 0) entries.splice(existingIndex, 1)
    entries.push([sessionId, usage])
    changed = true
  }

  if (!changed) return current as AgentSessionContextUsageSnapshotStore
  return Object.fromEntries(entries.slice(-MAX_CONTEXT_USAGE_SNAPSHOTS))
}
