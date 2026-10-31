/** Native context readings shared by the runtime, session cache and usage indicators. */
export interface AgentSessionContextUsage {
  /** Empty when the runtime only reports a total. Resource lists do not add to these categories. */
  categories: {
    id?: string
    name: string
    tokens: number
    kind?: 'used' | 'free' | 'buffer' | 'deferred'
    isDeferred?: boolean
  }[]
  /** Tokens currently occupying the context window, excluding reserves and deferred tools. */
  totalTokens: number
  /** Runtime accounting window, which may be reduced by compaction settings. */
  maxTokens: number
  /** Usage as a percentage of the context window (0–100). */
  percentage: number
  /** Model identifier the usage was measured against. */
  model: string
  mcpTools?: { name: string; serverName: string; tokens: number; isLoaded?: boolean }[]
  memoryFiles?: { path: string; type: string; tokens: number }[]
  agents?: { agentType: string; source: string; tokens: number }[]
}

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const
