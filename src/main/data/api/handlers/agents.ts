/**
 * Agents domain API Handlers
 *
 * Thin routing layer between the DataApi transport and the existing agent
 * service singletons. Each handler validates required inputs and delegates
 * to the appropriate service method.
 */

import { agentService } from '@data/services/AgentService'
import { agentTaskService as taskService } from '@data/services/AgentTaskService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  type AgentSchemas,
  CreateAgentSchema,
  CreateTaskSchema,
  ListAgentsQuerySchema,
  type ListQuery,
  ListQuerySchema,
  UpdateAgentSchema,
  UpdateTaskSchema
} from '@shared/data/api/schemas/agents'

function paginationFromQuery(query: ListQuery) {
  const page = query.page ?? 1
  const limit = query.limit ?? 50
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

function parseListQuery(query: unknown): ListQuery {
  const parsed = ListQuerySchema.safeParse(query ?? {})
  if (!parsed.success) throw toDataApiError(parsed.error)
  return parsed.data
}

export const agentHandlers: HandlersFor<AgentSchemas> = {
  '/agents': {
    GET: async ({ query }) => {
      const parsed = ListAgentsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const { search, page, limit } = parsed.data
      const offset = (page - 1) * limit
      const { agents, total } = await agentService.listAgents({ limit, offset, search })
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
      const { page, limit, offset } = paginationFromQuery(parseListQuery(query))
      const { tasks, total } = await taskService.listTasks(params.agentId, { limit, offset })
      return { items: tasks, total, page }
    },

    POST: async ({ params, body }) => {
      const parsed = CreateTaskSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await taskService.createTask(params.agentId, parsed.data)
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
      const task = await taskService.updateTask(params.agentId, params.taskId, parsed.data)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return task
    },

    DELETE: async ({ params }) => {
      const deleted = await taskService.deleteTask(params.agentId, params.taskId)
      if (!deleted) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return undefined
    }
  },

  '/agents/:agentId/tasks/:taskId/logs': {
    GET: async ({ params, query }) => {
      const task = await taskService.getTask(params.agentId, params.taskId)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      const { page, limit, offset } = paginationFromQuery(parseListQuery(query))
      const { logs, total } = await taskService.getTaskLogs(params.taskId, { limit, offset })
      return { items: logs, total, page }
    }
  }
}
