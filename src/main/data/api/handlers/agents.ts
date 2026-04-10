import { agentsDataService } from '@data/services/AgentsDataService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { AgentSchemas } from '@shared/data/api/schemas/agents'

type AgentHandler<Path extends keyof AgentSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const agentHandlers: {
  [Path in keyof AgentSchemas]: {
    [Method in keyof AgentSchemas[Path]]: AgentHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/agents': {
    GET: async ({ query }) => {
      return await agentsDataService.listAgents(query ?? {})
    },
    POST: async ({ body }) => {
      return await agentsDataService.createAgent(body)
    },
    PATCH: async ({ body }) => {
      await agentsDataService.reorderAgents(body.orderedIds)
      return { success: true as const }
    }
  },

  '/agents/:id': {
    GET: async ({ params }) => {
      return await agentsDataService.getAgent(params.id)
    },
    PATCH: async ({ params, body }) => {
      return await agentsDataService.updateAgent(params.id, body)
    },
    DELETE: async ({ params }) => {
      await agentsDataService.deleteAgent(params.id)
      return undefined
    }
  },

  '/agents/:agentId/sessions': {
    GET: async ({ params, query }) => {
      return await agentsDataService.listSessions(params.agentId, query ?? {})
    },
    POST: async ({ params, body }) => {
      return await agentsDataService.createSession(params.agentId, body)
    },
    PATCH: async ({ params, body }) => {
      await agentsDataService.reorderSessions(params.agentId, body.orderedIds)
      return { success: true as const }
    }
  },

  '/agents/:agentId/sessions/:id': {
    GET: async ({ params }) => {
      return await agentsDataService.getSession(params.agentId, params.id)
    },
    PATCH: async ({ params, body }) => {
      return await agentsDataService.updateSession(params.agentId, params.id, body)
    },
    DELETE: async ({ params }) => {
      await agentsDataService.deleteSession(params.agentId, params.id)
      return undefined
    }
  }
}
