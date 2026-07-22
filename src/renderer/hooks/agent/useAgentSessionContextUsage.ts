import { usePersistCache, useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionContextUsageSummary } from '@shared/data/cache/cacheValueTypes'
import { useEffect } from 'react'

const EMPTY_SESSION_ID = '__none__'
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
  const [snapshots, setSnapshots] = usePersistCache(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY)
  const persistedUsage = sessionId ? snapshots[sessionId] : undefined
  const sessionUsage = sessionId ? (cachedUsage ?? persistedUsage ?? null) : null

  useEffect(() => {
    if (!sessionId || !cachedUsage) return

    setSnapshots((previous) => {
      const current = previous[sessionId]
      if (current && snapshotMatchesUsage(current, cachedUsage)) return previous

      return {
        ...previous,
        [sessionId]: createSnapshot(cachedUsage)
      }
    })
  }, [cachedUsage, sessionId, setSnapshots])

  const effectiveUsage = isExpectedModelUsage(sessionUsage, expectedModels) ? sessionUsage : null
  const percentage =
    effectiveUsage?.percentage === undefined ? null : Math.round(Math.min(100, Math.max(0, effectiveUsage.percentage)))

  return { usage: effectiveUsage, percentage }
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

function createSnapshot(usage: AgentSessionContextUsage): AgentSessionContextUsageSummary {
  return {
    categories: usage.categories.map(({ name, tokens }) => ({ name, tokens })),
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    percentage: usage.percentage,
    model: usage.model
  }
}

function snapshotMatchesUsage(snapshot: AgentSessionContextUsageSummary, usage: AgentSessionContextUsage): boolean {
  return (
    snapshot.totalTokens === usage.totalTokens &&
    snapshot.maxTokens === usage.maxTokens &&
    snapshot.percentage === usage.percentage &&
    snapshot.model === usage.model &&
    snapshot.categories.length === usage.categories.length &&
    snapshot.categories.every((category, index) => {
      const current = usage.categories[index]
      return category.name === current.name && category.tokens === current.tokens
    })
  )
}
