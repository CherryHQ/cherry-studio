import * as z from 'zod'

import type { CursorPaginationResponse } from '../types'

export const MAX_AGENT_PLAN_STEPS = 200

const PlanStepIdSchema = z.uuid().toLowerCase()

const PlanStepBaseSchema = z.strictObject({
  id: PlanStepIdSchema,
  title: z.string().trim().min(1).max(1000),
  dependencyIds: z.array(PlanStepIdSchema).max(MAX_AGENT_PLAN_STEPS)
})

export const AgentPlanStepSchema = PlanStepBaseSchema.extend({
  status: z.enum(['pending', 'in-progress', 'completed', 'error'])
})
export type AgentPlanStep = z.infer<typeof AgentPlanStepSchema>

export const AgentPlanStateSchema = z.strictObject({
  objective: z.string().trim().min(1).max(8000),
  steps: z.array(AgentPlanStepSchema).max(MAX_AGENT_PLAN_STEPS)
})
export type AgentPlanState = z.infer<typeof AgentPlanStateSchema>

export const ReplaceAgentPlanSchema = AgentPlanStateSchema.pick({ objective: true }).extend({
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  steps: z.array(PlanStepBaseSchema).max(MAX_AGENT_PLAN_STEPS)
})
export type ReplaceAgentPlanDto = z.infer<typeof ReplaceAgentPlanSchema>

export const AgentPlanEntitySchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.string(),
  revision: z.number().int().positive(),
  state: AgentPlanStateSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  delivery: z.literal('unsupported')
})
export type AgentPlanEntity = z.infer<typeof AgentPlanEntitySchema>

export const AgentPlanHistoryEntitySchema = AgentPlanEntitySchema.pick({
  id: true,
  revision: true,
  state: true,
  createdAt: true
}).extend({ planId: z.uuid(), origin: z.literal('user-edit') })
export type AgentPlanHistoryEntity = z.infer<typeof AgentPlanHistoryEntitySchema>

export const AgentPlanHistoryQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(25).optional()
})
export type AgentPlanHistoryQuery = z.infer<typeof AgentPlanHistoryQuerySchema>

export type AgentPlanSchemas = {
  '/agent-sessions/:sessionId/plan': {
    GET: { params: { sessionId: string }; response: { plan: AgentPlanEntity | null } }
    PUT: { params: { sessionId: string }; body: ReplaceAgentPlanDto; response: AgentPlanEntity }
  }
  '/agent-sessions/:sessionId/plan/history': {
    GET: {
      params: { sessionId: string }
      query?: AgentPlanHistoryQuery
      response: CursorPaginationResponse<AgentPlanHistoryEntity>
    }
  }
}
