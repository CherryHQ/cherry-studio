import * as z from 'zod'

export const DASHBOARD_LONG_RUN_MS = 60_000
export const DASHBOARD_IDLE_SECONDS = 300
export const DASHBOARD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export const DashboardStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type DashboardStatus = z.infer<typeof DashboardStatusSchema>
export type DashboardFinalStatus = Exclude<DashboardStatus, 'queued' | 'running'>

export interface DashboardRun {
  id: string
  source: 'scheduled' | 'agent'
  runId: string
  taskId: string | null
  sessionId: string | null
  agentId: string | null
  nameSnapshot: string
  agentNameSnapshot: string
  messageAnchor: string | null
  startedAt: number | null
  endedAt: number | null
  lastActivityAt: number | null
  status: DashboardStatus
  blockedOn: 'approval' | null
  reasonCode: string | null
  errorSummary: string | null
  viewedAt: number | null
}

export interface DashboardEntry extends DashboardRun {
  runIds: string[]
  runCount: number
}

export interface DashboardPage {
  items: DashboardEntry[]
  totals: { running: number; awaiting: number }
  nextCursor?: string
}

export const DashboardQuerySchema = z.strictObject({
  group: z.enum(['running', 'awaiting']),
  cursor: z.string().max(1024).optional()
})
export const ReviewDashboardSchema = z.strictObject({
  viewed: z.literal(true),
  taskId: z.string().min(1).optional()
})
export const ReviewDashboardRunSchema = z.strictObject({ viewed: z.literal(true) })

export type AgentTaskDashboardSchemas = {
  '/agent-task-dashboard': {
    GET: { query: z.infer<typeof DashboardQuerySchema>; response: DashboardPage }
    PATCH: { body: z.infer<typeof ReviewDashboardSchema>; response: void }
  }
  '/agent-task-dashboard/:id': {
    PATCH: { params: { id: string }; body: z.infer<typeof ReviewDashboardRunSchema>; response: void }
  }
}

export interface DashboardStopResult {
  id: string
  result: 'cancelled' | 'skipped' | 'failed'
}
