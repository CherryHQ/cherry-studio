import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage,
  AgentSessionContextUsageSchema,
  type AgentSessionContextUsageSnapshot,
  type AgentSessionContextUsageSource
} from '@shared/ai/agentSessionContextUsage'

const EMPTY_SESSION_ID = '__none__'
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g')

interface AgentSessionContextUsageState {
  usage: AgentSessionContextUsage | null
  percentage: number | null
  source: AgentSessionContextUsageSource
  capturedAt?: number
}

export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  expectedModels?: readonly (string | null | undefined)[],
  fallbackSnapshot?: AgentSessionContextUsageSnapshot | null
): AgentSessionContextUsageState {
  const cachedUsage = useSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  const sessionUsage = sessionId && isContextUsage(cachedUsage) ? cachedUsage : null
  const liveUsage = isExpectedModelUsage(sessionUsage, expectedModels) ? sessionUsage : null
  const fallbackSnapshotUsage = isExpectedModelUsage(fallbackSnapshot?.usage ?? null, expectedModels)
    ? fallbackSnapshot
    : null
  const effectiveSnapshot = fallbackSnapshotUsage
  const snapshotUsage = sessionId && effectiveSnapshot ? effectiveSnapshot.usage : null
  const effectiveUsage = liveUsage ?? snapshotUsage
  const source: AgentSessionContextUsageSource = liveUsage ? 'live' : snapshotUsage ? 'snapshot' : 'none'
  const percentage =
    effectiveUsage?.percentage === undefined ? null : Math.round(Math.min(100, Math.max(0, effectiveUsage.percentage)))

  return {
    usage: effectiveUsage,
    percentage,
    source,
    capturedAt: source === 'snapshot' ? effectiveSnapshot?.capturedAt : undefined
  }
}

function isContextUsage(value: AgentSessionContextUsage | null | undefined): value is AgentSessionContextUsage {
  return AgentSessionContextUsageSchema.safeParse(value).success
}

function isExpectedModelUsage(
  usage: AgentSessionContextUsage | null,
  expectedModels: readonly (string | null | undefined)[] | undefined
): boolean {
  if (!usage) return true
  const expected = expectedModels?.map(normalizeModelId).filter((model): model is string => Boolean(model))
  if (!expected?.length) return true

  const actual = normalizeModelId(usage.model)
  return Boolean(actual && expected.some((candidate) => isSameModel(actual, candidate)))
}

function normalizeModelId(model: string | null | undefined): string | undefined {
  const withoutProvider = model
    ?.trim()
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\[1m\]$/i, '')
    .split('::')
    .at(-1)
  const normalized = withoutProvider?.toLowerCase()
  return normalized || undefined
}

function isSameModel(actual: string, expected: string): boolean {
  return actual === expected || isDatedModelAlias(actual, expected)
}

function isDatedModelAlias(actual: string, expected: string): boolean {
  const suffix = actual.startsWith(`${expected}-`) ? actual.slice(expected.length + 1) : undefined
  return !!suffix && /^\d{8}$/.test(suffix)
}
