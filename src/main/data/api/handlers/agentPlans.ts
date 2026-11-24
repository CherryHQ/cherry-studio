import { application } from '@application'
import { agentPlanService } from '@data/services/AgentPlanService'
import { AgentSessionEditError } from '@data/services/AgentSessionEditError'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import {
  type AgentPlanSchemas,
  AgentPlanHistoryQuerySchema,
  ReplaceAgentPlanSchema
} from '@shared/data/api/schemas/agentPlans'
import type { HandlersFor } from '@shared/data/api/types'

export const agentPlanHandlers: HandlersFor<AgentPlanSchemas> = {
  '/agent-sessions/:sessionId/plan': {
    GET: async ({ params }) => ({ plan: agentPlanService.get(params.sessionId) }),
    PUT: async ({ params, body }) => {
      const parsed = ReplaceAgentPlanSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      try {
        return await application.get('AgentSessionRuntimeService').replaceHostPlan(params.sessionId, parsed.data)
      } catch (error) {
        if (error instanceof AgentSessionEditError) {
          throw DataApiErrorFactory.conflict(`Session is not editable: ${error.reason}`, 'Agent plan')
        }
        throw error
      }
    }
  },
  '/agent-sessions/:sessionId/plan/history': {
    GET: async ({ params, query }) => {
      const parsed = AgentPlanHistoryQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentPlanService.history(params.sessionId, parsed.data)
    }
  }
}
