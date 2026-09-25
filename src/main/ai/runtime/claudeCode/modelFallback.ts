import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { RetryPolicy } from '../aiSdk'
import { ClaudeCodeResultError } from './streamAdapter'

/** Provider statuses that justify leaving the primary model for this turn. */
const FALLBACK_STATUS_CODES = new Set([429, 500, 502, 503, 529])
const STATUS_ERROR_PATTERN = /\b(429|500|502|503|529)\b/
const RATE_LIMIT_ERROR_PATTERN = /rate.?limit|overloaded|quota|resource_exhausted/i

export interface AgentSessionFallbackDecision {
  fallbackModelId: UniqueModelId
  /** Short technical cause shown in the transcript notice, e.g. "http 429". */
  reason: string
}

export interface AgentSessionFallbackInput {
  error: unknown
  currentModelId: UniqueModelId
  /** A turn that already produced content stays on its model — a restart would duplicate it. */
  hasTurnActivity: boolean
  policy: RetryPolicy
}

/**
 * Returns a short failure reason when the error is a retryable provider failure, else undefined.
 * Only SDK result errors carry the structured status/terminal-reason facts we trust; aborts and
 * process failures never qualify.
 */
export function classifyFallbackEligibleError(error: unknown): string | undefined {
  if (!(error instanceof ClaudeCodeResultError)) return undefined
  if (error.statusCode != null) {
    return FALLBACK_STATUS_CODES.has(error.statusCode) ? `http ${error.statusCode}` : undefined
  }
  if (error.terminalReason !== 'api_error') return undefined
  const matched = error.errors.find((entry) => STATUS_ERROR_PATTERN.test(entry) || RATE_LIMIT_ERROR_PATTERN.test(entry))
  if (!matched) return undefined
  const status = matched.match(STATUS_ERROR_PATTERN)
  return status ? `http ${status[1]}` : matched.slice(0, 80)
}

/** First configured fallback that is a well-formed id and differs from the model that just failed. */
export function selectFallbackModelId(policy: RetryPolicy, currentModelId: UniqueModelId): UniqueModelId | undefined {
  if (!policy.enabled) return undefined
  return policy.fallbackModelIds.find((candidate) => isUniqueModelId(candidate) && candidate !== currentModelId)
}

export function resolveAgentSessionFallback(
  input: AgentSessionFallbackInput
): AgentSessionFallbackDecision | undefined {
  if (input.hasTurnActivity) return undefined
  const reason = classifyFallbackEligibleError(input.error)
  if (!reason) return undefined
  const fallbackModelId = selectFallbackModelId(input.policy, input.currentModelId)
  if (!fallbackModelId) return undefined
  return { fallbackModelId, reason }
}
