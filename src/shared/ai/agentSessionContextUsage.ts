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
