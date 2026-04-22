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

import { agentService } from '@main/services/agents/services/AgentService'
import { sessionMessageService } from '@main/services/agents/services/SessionMessageService'
import { sessionService } from '@main/services/agents/services/SessionService'
import { taskService } from '@main/services/agents/services/TaskService'
import { skillService } from '@main/services/agents/skills/SkillService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type {
  AgentSchemas,
  CreateAgentDto,
  CreateSessionDto,
  CreateTaskDto,
  UpdateAgentDto,
  UpdateSessionDto,
  UpdateTaskDto
} from '@shared/data/api/schemas/agents'
import type {
  CreateAgentRequest,
  CreateSessionRequest,
  CreateTaskRequest,
  UpdateAgentRequest,
  UpdateSessionRequest,
  UpdateTaskRequest
} from '@types'

type AgentHandler<Path extends keyof AgentSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

function requireFields(body: Record<string, unknown> | undefined, fields: string[]): void {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '')
  if (missing.length > 0) {
    const fieldErrors = Object.fromEntries(missing.map((f) => [f, ['is required']]))
    throw DataApiErrorFactory.validation(fieldErrors, `Missing required fields: ${missing.join(', ')}`)
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

function toAgentRequest(dto: CreateAgentDto): CreateAgentRequest {
  return stripUndefined({
    type: dto.type,
    name: dto.name,
    model: dto.model,
    description: dto.description,
    accessible_paths: dto.accessiblePaths ?? [],
    instructions: dto.instructions,
    plan_model: dto.planModel,
    small_model: dto.smallModel,
    mcps: dto.mcps,
    allowed_tools: dto.allowedTools,
    slash_commands: dto.slashCommands,
    configuration: dto.configuration
  }) as CreateAgentRequest
}

function toAgentUpdateRequest(dto: UpdateAgentDto): UpdateAgentRequest {
  return stripUndefined({
    name: dto.name,
    description: dto.description,
    accessible_paths: dto.accessiblePaths,
    instructions: dto.instructions,
    model: dto.model,
    plan_model: dto.planModel,
    small_model: dto.smallModel,
    mcps: dto.mcps,
    allowed_tools: dto.allowedTools,
    slash_commands: dto.slashCommands,
    configuration: dto.configuration
  }) as UpdateAgentRequest
}

function toSessionRequest(dto: Partial<CreateSessionDto>): CreateSessionRequest {
  return stripUndefined({
    model: dto.model,
    name: dto.name,
    description: dto.description,
    accessible_paths: dto.accessiblePaths,
    instructions: dto.instructions,
    plan_model: dto.planModel,
    small_model: dto.smallModel,
    mcps: dto.mcps,
    allowed_tools: dto.allowedTools,
    slash_commands: dto.slashCommands,
    configuration: dto.configuration
  }) as CreateSessionRequest
}

function toSessionUpdateRequest(dto: UpdateSessionDto): UpdateSessionRequest {
  return stripUndefined({
    model: dto.model,
    name: dto.name,
    description: dto.description,
    accessible_paths: dto.accessiblePaths,
    instructions: dto.instructions,
    plan_model: dto.planModel,
    small_model: dto.smallModel,
    mcps: dto.mcps,
    allowed_tools: dto.allowedTools,
    slash_commands: dto.slashCommands,
    configuration: dto.configuration
  }) as UpdateSessionRequest
}

function toTaskRequest(dto: CreateTaskDto): CreateTaskRequest {
  return stripUndefined({
    name: dto.name,
    prompt: dto.prompt,
    schedule_type: dto.scheduleType,
    schedule_value: dto.scheduleValue,
    timeout_minutes: dto.timeoutMinutes,
    channel_ids: dto.channelIds
  }) as CreateTaskRequest
}

function toTaskUpdateRequest(dto: UpdateTaskDto): UpdateTaskRequest {
  return stripUndefined({
    name: dto.name,
    prompt: dto.prompt,
    schedule_type: dto.scheduleType,
    schedule_value: dto.scheduleValue,
    timeout_minutes: dto.timeoutMinutes,
    channel_ids: dto.channelIds,
    status: dto.status
  }) as UpdateTaskRequest
}

export const agentHandlers: {
  [Path in keyof AgentSchemas]: {
    [Method in keyof AgentSchemas[Path]]: AgentHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/agents': {
    GET: async ({ query }) => {
      const limit = query?.limit ?? 50
      const offset = query?.offset ?? 0
      const { agents, total } = await agentService.listAgents({ limit, offset })
      return { data: agents, total, limit, offset }
    },

    POST: async ({ body }) => {
      requireFields(body as unknown as Record<string, unknown>, ['type', 'name', 'model'])
      return await agentService.createAgent(toAgentRequest(body))
    }
  },

  '/agents/:agentId': {
    GET: async ({ params }) => {
      const agent = await agentService.getAgent(params.agentId)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return agent
    },

    PATCH: async ({ params, body }) => {
      const agent = await agentService.updateAgent(params.agentId, toAgentUpdateRequest(body ?? {}))
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return agent
    },

    DELETE: async ({ params }) => {
      const deleted = await agentService.deleteAgent(params.agentId)
      if (!deleted) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return undefined
    }
  },

  '/agents/:agentId/sessions': {
    GET: async ({ params, query }) => {
      const limit = query?.limit ?? 50
      const offset = query?.offset ?? 0
      const { sessions, total } = await sessionService.listSessions(params.agentId, { limit, offset })
      return { data: sessions, total, limit, offset }
    },

    POST: async ({ params, body }) => {
      const session = await sessionService.createSession(params.agentId, toSessionRequest(body ?? {}))
      if (!session) {
        throw DataApiErrorFactory.invalidOperation('create session', 'service returned a falsy result')
      }
      return session
    }
  },

  '/agents/:agentId/sessions/:sessionId': {
    GET: async ({ params }) => {
      const session = await sessionService.getSession(params.agentId, params.sessionId)
      if (!session) throw DataApiErrorFactory.notFound('Session', params.sessionId)
      return session
    },

    PATCH: async ({ params, body }) => {
      const session = await sessionService.updateSession(
        params.agentId,
        params.sessionId,
        toSessionUpdateRequest(body ?? {})
      )
      if (!session) throw DataApiErrorFactory.notFound('Session', params.sessionId)
      return session
    },

    DELETE: async ({ params }) => {
      const deleted = await sessionService.deleteSession(params.agentId, params.sessionId)
      if (!deleted) throw DataApiErrorFactory.notFound('Session', params.sessionId)
      return undefined
    }
  },

  '/agents/:agentId/sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const sessionExists = await sessionService.sessionExists(params.agentId, params.sessionId)
      if (!sessionExists) throw DataApiErrorFactory.notFound('Session', params.sessionId)
      return await sessionMessageService.listSessionMessages(params.sessionId, query)
    }
  },

  '/agents/:agentId/sessions/:sessionId/messages/:messageId': {
    DELETE: async ({ params }) => {
      const sessionExists = await sessionService.sessionExists(params.agentId, params.sessionId)
      if (!sessionExists) throw DataApiErrorFactory.notFound('Session', params.sessionId)
      const messageId = /^\d+$/.test(params.messageId) ? Number(params.messageId) : NaN
      if (!Number.isFinite(messageId)) {
        throw DataApiErrorFactory.validation({ messageId: ['must be a positive integer'] }, 'Invalid message id')
      }
      const deleted = await sessionMessageService.deleteSessionMessage(params.sessionId, messageId)
      if (!deleted) throw DataApiErrorFactory.notFound('Message', params.messageId)
      return undefined
    }
  },

  '/agents/:agentId/tasks': {
    GET: async ({ params, query }) => {
      const limit = query?.limit ?? 50
      const offset = query?.offset ?? 0
      const { tasks, total } = await taskService.listTasks(params.agentId, { limit, offset })
      return { data: tasks, total, limit, offset }
    },

    POST: async ({ params, body }) => {
      requireFields(body as unknown as Record<string, unknown>, ['name', 'prompt', 'scheduleType', 'scheduleValue'])
      return await taskService.createTask(params.agentId, toTaskRequest(body))
    }
  },

  '/agents/:agentId/tasks/:taskId': {
    GET: async ({ params }) => {
      const task = await taskService.getTask(params.agentId, params.taskId)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return task
    },

    PATCH: async ({ params, body }) => {
      const task = await taskService.updateTask(params.agentId, params.taskId, toTaskUpdateRequest(body ?? {}))
      if (!task) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return task
    },

    DELETE: async ({ params }) => {
      const deleted = await taskService.deleteTask(params.agentId, params.taskId)
      if (!deleted) throw DataApiErrorFactory.notFound('Task', params.taskId)
      return undefined
    }
  },

  '/skills': {
    GET: async () => {
      const skills = await skillService.list()
      return { data: skills }
    }
  },

  '/skills/:id': {
    GET: async ({ params }) => {
      const skill = await skillService.getById(params.id)
      if (!skill) throw DataApiErrorFactory.notFound('Skill', params.id)
      return skill
    }
  }
}
