/**
 * Agents domain API Handlers
 *
 * Thin routing layer between the DataApi transport and the existing agent
 * service singletons. Each handler validates its inputs and delegates to the
 * appropriate service method.
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
import type { AgentSchemas } from '@shared/data/api/schemas/agents'

type AgentHandler<Path extends keyof AgentSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const agentHandlers: {
  [Path in keyof AgentSchemas]: {
    [Method in keyof AgentSchemas[Path]]: AgentHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/agents': {
    GET: async () => {
      const { agents, total } = await agentService.listAgents()
      return { data: agents as any[], total, limit: agents.length, offset: 0 }
    },

    POST: async ({ body }) => {
      const agent = await agentService.createAgent(body as any)
      return agent as any
    }
  },

  '/agents/:id': {
    GET: async ({ params }) => {
      const agent = await agentService.getAgent(params.id)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.id)
      return agent as any
    },

    PATCH: async ({ params, body }) => {
      const agent = await agentService.updateAgent(params.id, body as any)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', params.id)
      return agent as any
    },

    DELETE: async ({ params }) => {
      const deleted = await agentService.deleteAgent(params.id)
      if (!deleted) throw DataApiErrorFactory.notFound('Agent', params.id)
      return undefined
    }
  },

  '/agents/:id/sessions': {
    GET: async ({ params }) => {
      const { sessions, total } = await sessionService.listSessions(params.id)
      return { data: sessions as any[], total, limit: sessions.length, offset: 0 }
    },

    POST: async ({ params, body }) => {
      const session = await sessionService.createSession(params.id, body as any)
      return session as any
    }
  },

  '/agents/:id/sessions/:sid': {
    GET: async ({ params }) => {
      const session = await sessionService.getSession(params.id, params.sid)
      if (!session) throw DataApiErrorFactory.notFound('Session', params.sid)
      return session as any
    },

    PATCH: async ({ params, body }) => {
      const session = await sessionService.updateSession(params.id, params.sid, body as any)
      if (!session) throw DataApiErrorFactory.notFound('Session', params.sid)
      return session as any
    },

    DELETE: async ({ params }) => {
      const deleted = await sessionService.deleteSession(params.id, params.sid)
      if (!deleted) throw DataApiErrorFactory.notFound('Session', params.sid)
      return undefined
    }
  },

  '/agents/:id/sessions/:sid/messages': {
    GET: async ({ params, query }) => {
      return await sessionMessageService.listSessionMessages(params.sid, query as any)
    },

    DELETE: async ({ params }) => {
      const deleted = await sessionMessageService.deleteSessionMessage(params.sid, (params as any).messageId)
      if (!deleted) throw DataApiErrorFactory.notFound('Message', String((params as any).messageId))
      return undefined
    }
  },

  '/agents/:id/tasks': {
    GET: async ({ params }) => {
      const { tasks, total } = await taskService.listTasks(params.id)
      return { data: tasks as any[], total, limit: tasks.length, offset: 0 }
    },

    POST: async ({ params, body }) => {
      return await taskService.createTask(params.id, body as any)
    }
  },

  '/agents/:id/tasks/:tid': {
    GET: async ({ params }) => {
      const task = await taskService.getTask(params.id, params.tid)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.tid)
      return task
    },

    PATCH: async ({ params, body }) => {
      const task = await taskService.updateTask(params.id, params.tid, body as any)
      if (!task) throw DataApiErrorFactory.notFound('Task', params.tid)
      return task
    },

    DELETE: async ({ params }) => {
      const deleted = await taskService.deleteTask(params.id, params.tid)
      if (!deleted) throw DataApiErrorFactory.notFound('Task', params.tid)
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
      const skills = await skillService.list()
      const skill = skills.find((s) => s.id === params.id)
      if (!skill) throw DataApiErrorFactory.notFound('Skill', params.id)
      return skill
    }
  }
}
