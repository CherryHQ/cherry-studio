export const AGENT_TASK_DASHBOARD_CACHE_KEY = 'agent.task_dashboard.running' as const
export const DASHBOARD_LONG_RUN_MS = 60_000
export const DASHBOARD_PAGE_SIZE = 50

/** Main-owned, ephemeral projection of currently executing work. */
export interface DashboardEntry {
  id: string
  source: 'scheduled' | 'agent'
  taskId: string | null
  sessionId: string | null
  agentId: string | null
  nameSnapshot: string
  agentNameSnapshot: string
  messageAnchor: string | null
  startedAt: number
  blockedOn: 'approval' | null
  runIds: string[]
  runCount: number
}

export interface DashboardStopResult {
  id: string
  result: 'cancelled' | 'skipped' | 'failed'
}
