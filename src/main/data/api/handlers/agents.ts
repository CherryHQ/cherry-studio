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
    }
  },

  '/agents/:id': {
    GET: async ({ params }) => {
      return await agentsDataService.getAgent(params.id)
    }
  },

  '/agents/:agentId/sessions': {
    GET: async ({ params, query }) => {
      return await agentsDataService.listSessions(params.agentId, query ?? {})
    }
  },

  '/agents/:agentId/sessions/:id': {
    GET: async ({ params }) => {
      return await agentsDataService.getSession(params.agentId, params.id)
    }
  }
}
