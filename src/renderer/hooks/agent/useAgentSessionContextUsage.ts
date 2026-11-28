import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import type { Model } from '@shared/data/types/model'

export type AgentSessionContextUsageUnavailableReason =
  | 'compacted'
  | 'model-changed'
  | 'reset'
  | 'unsupported'
  | 'unknown-window'
  | 'read-failed'

interface AgentSessionContextUsageState {
  usage: ThreadContextUsage | null
  percentage: number | null
  maxTokens: number | null
  status: OperationResult<ThreadContextUsage>['status'] | null
  measuredAt: number | null
  stale: boolean
  unavailableReason: AgentSessionContextUsageUnavailableReason | null
}

function resolveUnavailableReason(
  result: OperationResult<ThreadContextUsage> | undefined,
  modelMismatch: boolean
): AgentSessionContextUsageUnavailableReason | null {
  if (modelMismatch) return 'model-changed'
  if (!result) return null
  if (result.status === 'confirmed') return result.value.used ? null : 'compacted'
  if (result.status === 'unsupported') return 'unsupported'
  switch (result.error.code) {
    case 'compacted':
      return 'compacted'
    case 'model-changed':
      return 'model-changed'
    case 'reset':
      return 'reset'
    case 'no-model':
    case 'unknown-window':
      return 'unknown-window'
    default:
      return 'read-failed'
  }
}

export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  model?: Model
): AgentSessionContextUsageState {
  const cached = useSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? '__none__'))
  const modelMismatch = Boolean(sessionId && model && cached?.modelId && cached.modelId !== model.id)
  const result = sessionId && !modelMismatch ? cached?.result : undefined
  const usage = result?.status === 'confirmed' ? result.value : null
  const maxTokens = usage?.contextWindow ?? null
  const percentage =
    usage?.used && maxTokens ? Math.round(Math.min(100, Math.max(0, (usage.used.tokens / maxTokens) * 100))) : null
  const stale = Boolean(usage?.used && cached?.stale)
  const measuredAt = stale && typeof cached?.measuredAt === 'number' ? cached.measuredAt : null
  const unavailableReason = percentage !== null ? null : resolveUnavailableReason(result, modelMismatch)
  return { usage, percentage, maxTokens, status: result?.status ?? null, measuredAt, stale, unavailableReason }
}
