/**
 * Agents domain API Handlers
 *
 * Thin routing layer between the DataApi transport and the existing agent
 * service singletons. Each handler validates required inputs and delegates
 * to the appropriate service method.
 */

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService as taskService } from '@data/services/AgentTaskService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  type AgentSchemas,
  ListAgentsQuerySchema,
  type ListQuery,
  ListQuerySchema,
  UpdateAgentSchema
} from '@shared/data/api/schemas/agents'
import type { HandlersFor } from '@shared/data/api/types'

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
  '/agent-tasks': {
    GET: async ({ query }) => {
      const { page, limit, offset } = paginationFromQuery(parseListQuery(query))
      const { tasks, total } = taskService.listAllTasks({ limit, offset })
      return { items: tasks, total, page }
    }
  },

  '/agent-tasks/:taskId': {
    GET: async ({ params }) => {
      const task = taskService.getTaskById(params.taskId)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return task
    }
  },

  '/agents': {
    GET: async ({ query }) => {
      const parsed = ListAgentsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const { search, page, limit } = parsed.data
      const offset = (page - 1) * limit
      const { agents, total } = agentService.listAgents({ limit, offset, search })
      return { items: agents, total, page }
    }
  },

  '/agents/:agentId': {
    GET: async ({ params }) => {
      const agent = agentService.getAgent(params.agentId)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return agent
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      const agent = agentService.updateAgent(params.agentId, parsed.data)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return agent
    },

    DELETE: async ({ params }) => {
      // Pre-check existence so not-found returns 404 instead of an opaque 204,
      // and so a synchronous failure from the DB delete is not silently masked
      // by the post-commit cleanup catch below.
      if (!agentService.agentExists(params.agentId)) {
        throw DataApiErrorFactory.notFound('Agent', params.agentId)
      }
      // Synchronously remove the agent row and any dependent rows first.
      const syncResult = agentService.deleteAgent(params.agentId, { deleteSessions: false })
      if (!syncResult.deleted) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      // Then pause any active turns and close the affected session runtimes.
      // These run after the row is gone, so a failure here must not be reported
      // back as a deletion error — the row is already removed.
      try {
        const manager = application.get('AiStreamManager')
        const sessionsResult = agentSessionService.listByCursor({ agentId: params.agentId, limit: 1000 })
        for (const session of sessionsResult.items) {
          manager.pauseRuntimeTurn(buildAgentSessionTopicId(session.id), 'target-agent-deleted')
        }
        await Promise.allSettled(
          sessionsResult.items.map((session) => application.get('AgentSessionRuntimeService').closeSession(session.id))
        )
      } catch (error) {
        loggerService.withContext('DataApi:agents').warn('Agent runtime cleanup failed after row deletion', {
          agentId: params.agentId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      return undefined
    }
  },

  // Task reads only — task mutations are mixed-effect commands (schedule row +
  // subscriptions + timer) and live on IpcApi `ai.agent.task.*` (AgentJobsService).
  '/agents/:agentId/tasks': {
    GET: async ({ params, query }) => {
      const { page, limit, offset } = paginationFromQuery(parseListQuery(query))
      const { tasks, total } = taskService.listTasks(params.agentId, { limit, offset })
      return { items: tasks, total, page }
    }
  },

  '/agents/:agentId/tasks/:taskId': {
    GET: async ({ params }) => {
      const task = taskService.getTask(params.agentId, params.taskId)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return task
    }
  },

  '/agents/:agentId/tasks/:taskId/logs': {
    GET: async ({ params, query }) => {
      const task = taskService.getTask(params.agentId, params.taskId)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      const { page, limit, offset } = paginationFromQuery(parseListQuery(query))
      const { logs, total } = taskService.getTaskLogs(params.taskId, { limit, offset })
      return { items: logs, total, page }
    }
  },

  '/agents/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      agentService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agents/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      agentService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
