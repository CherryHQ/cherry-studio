/**
 * Agents domain API Handlers
 *
 * Thin routing layer between the DataApi transport and the existing agent
 * service singletons. Each handler validates required inputs and delegates
 * to the appropriate service method.
 *
 * Service layer: src/main/services/agents/services/
 * Skills layer:  src/main/services/agents/skills/SkillService
 */

import { agentService } from '@data/services/AgentService'
import { agentTaskService as taskService } from '@data/services/AgentTaskService'
import { agentTaskWorkflowService } from '@data/services/AgentTaskWorkflowService'
import { skillService } from '@main/services/agents/skills/SkillService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  type AgentSchemas,
  CreateAgentSchema,
  CreateTaskSchema,
  ListQuerySchema,
  UpdateAgentSchema,
  UpdateTaskSchema
} from '@shared/data/api/schemas/agents'
import * as z from 'zod'

const SkillListQuerySchema = z.strictObject({
  agentId: z.string().optional()
})

export const agentHandlers: HandlersFor<AgentSchemas> = {
  '/agents': {
    GET: async ({ query }) => {
      const parsed = ListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const { page, limit } = parsed.data
      const { agents, total } = await agentService.listAgents({ limit, offset: (page - 1) * limit })
      return { items: agents, total, page }
    },

    POST: async ({ body }) => {
      const parsed = CreateAgentSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentService.createAgent(parsed.data)
    }
  },

  '/agents/:agentId': {
    GET: async ({ params }) => {
      const agent = await agentService.getAgent(params.agentId)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return agent
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      const agent = await agentService.updateAgent(params.agentId, parsed.data)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return agent
    },

    DELETE: async ({ params }) => {
      const deleted = await agentService.deleteAgent(params.agentId)
      if (!deleted) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return undefined
    }
  },

  '/agents/:agentId/tasks': {
    GET: async ({ params, query }) => {
      const parsed = ListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const { page, limit } = parsed.data
      const { tasks, total } = await taskService.listTasks(params.agentId, { limit, offset: (page - 1) * limit })
      return { items: tasks, total, page }
    },

    POST: async ({ params, body }) => {
      const parsed = CreateTaskSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentTaskWorkflowService.createTask(params.agentId, parsed.data)
    }
  },

  '/agents/:agentId/tasks/:taskId': {
    GET: async ({ params }) => {
      const task = await taskService.getTask(params.agentId, params.taskId)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return task
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateTaskSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      const task = await agentTaskWorkflowService.updateTask(params.agentId, params.taskId, parsed.data)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return task
    },

    DELETE: async ({ params }) => {
      const deleted = await agentTaskWorkflowService.deleteTask(params.agentId, params.taskId)
      if (!deleted) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return undefined
    }
  },

  '/skills': {
    GET: async ({ query }) => {
      const parsed = SkillListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      if (parsed.data.agentId) {
        const agent = await agentService.getAgent(parsed.data.agentId)
        if (!agent) throw DataApiErrorFactory.notFound('Agent', parsed.data.agentId)
      }
      return await skillService.list(parsed.data.agentId)
    }
  },

  '/skills/:skillId': {
    GET: async ({ params }) => {
      const skill = await skillService.getById(params.skillId)
      if (!skill) throw DataApiErrorFactory.notFound('Skill', params.skillId)
      return skill
    }
  },

  '/agents/:agentId/tasks/:taskId/logs': {
    GET: async ({ params, query }) => {
      const task = await taskService.getTask(params.agentId, params.taskId)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      const parsed = ListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const { page, limit } = parsed.data
      const { logs, total } = await taskService.getTaskLogs(params.taskId, { limit, offset: (page - 1) * limit })
      return { items: logs, total, page }
    }
  },

  '/agents/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await agentService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agents/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await agentService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
