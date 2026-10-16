import * as z from 'zod'

import { agentTaskRunService } from '@data/services/AgentTaskRunService'
import {
  type AgentTaskDashboardSchemas,
  DashboardQuerySchema,
  ReviewDashboardRunSchema,
  ReviewDashboardSchema
} from '@shared/data/api/schemas/agentTaskDashboard'
import type { HandlersFor } from '@shared/data/api/types'

export const agentTaskDashboardHandlers: HandlersFor<AgentTaskDashboardSchemas> = {
  '/agent-task-dashboard': {
    GET: async ({ query }) => {
      const { group, cursor } = DashboardQuerySchema.parse(query)
      return agentTaskRunService.list(group, cursor)
    },
    PATCH: async ({ body }) => {
      const { taskId } = ReviewDashboardSchema.parse(body)
      agentTaskRunService.review({ taskId })
    }
  },
  '/agent-task-dashboard/:id': {
    PATCH: async ({ params, body }) => {
      ReviewDashboardRunSchema.parse(body)
      agentTaskRunService.review({ id: z.uuid().parse(params.id) })
    }
  }
}
