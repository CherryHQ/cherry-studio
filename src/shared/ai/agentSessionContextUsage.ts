import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'

// Driver-neutral context-usage payload cached per session and read by the renderer usage indicators
// (composer ring, right-pane summary). Both agent-session drivers produce it: the Claude driver's SDK
// response (`SDKControlGetContextUsageResponse`) is structurally a superset and stays assignable; the
// pi driver synthesizes it from pi's `ContextUsage`, which has no per-category breakdown (so
// `categories: []`). Only the fields the renderer actually reads live here, so a shape change in
// either driver surfaces at compile time instead of silently diverging the cached contract.
export interface AgentSessionContextUsage {
  /** Per-category token breakdown. Empty when the driver can't produce one (pi). */
  categories: { name: string; tokens: number }[]
  /** Tokens currently occupying the context window. */
  totalTokens: number
  /** Effective context-window size in tokens. */
  maxTokens: number
  /** Usage as a percentage of the context window (0–100). */
  percentage: number
  /** Model identifier the usage was measured against. */
  model: string
}

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const

// Claude's reported window includes plan limits; other drivers report Cherry's output-reserved budget.
export function resolveMaxTokens(
  usage: AgentSessionContextUsage | null,
  contextWindow: number | undefined
): number | null {
  if (!usage) return null
  const reported = usage.maxTokens > 0 ? usage.maxTokens : null
  if (typeof contextWindow !== 'number' || contextWindow <= 0) return reported
  if (reported && usage.model.trim().toLowerCase().startsWith('claude-')) return Math.min(contextWindow, reported)
  return contextWindow
}

export function getContextUsageModelCandidates(model: Model | undefined): string[] | undefined {
  if (!model) return undefined
  let parsed: ReturnType<typeof parseUniqueModelId>
  try {
    parsed = parseUniqueModelId(model.id)
  } catch {
    return [model.apiModelId ?? model.id]
  }
  const apiModelId = model.apiModelId ?? parsed.modelId
  const candidates = [apiModelId, parsed.modelId]
  try {
    candidates.push(formatGatewayModelId(parsed.providerId, apiModelId))
  } catch {
    /* Direct model IDs remain valid when gateway addressing is unavailable. */
  }
  return candidates
}

export function isExpectedModelUsage(
  usage: AgentSessionContextUsage | null,
  expectedModels: readonly (string | null | undefined)[] | undefined
): boolean {
  if (!usage) return true
  const normalize = (model: string | null | undefined) =>
    model
      ?.trim()
      .replace(/\[1m\]$/i, '')
      .toLowerCase() || undefined
  const expected = expectedModels?.map(normalize).filter((model): model is string => Boolean(model))
  if (!expected?.length) return true
  const actual = normalize(usage.model)
  return Boolean(actual && expected.includes(actual))
}
