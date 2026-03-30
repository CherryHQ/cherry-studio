/**
 * Agent API Handlers
 *
 * Implements all agent-related API endpoints including:
 * - Agent CRUD (soft delete)
 * - Session CRUD (auto-creates topic, snapshots agent config)
 * - Session messages retrieval
 *
 * All input validation happens here at the system boundary.
 */

import { agentDataService } from '@data/services/AgentDataService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { AgentSchemas } from '@shared/data/api/schemas/agents'
import {
  CreateAgentSchema,
  CreateAgentSessionSchema,
  ReorderAgentsSchema,
  UpdateAgentSchema
} from '@shared/data/api/schemas/agents'

type AgentHandler<Path extends keyof AgentSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const agentHandlers: {
  [Path in keyof AgentSchemas]: {
    [Method in keyof AgentSchemas[Path]]: AgentHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/agents': {
    GET: async ({ query }) => {
      return await agentDataService.listAgents(query)
    },

    POST: async ({ body }) => {
      const parsed = CreateAgentSchema.parse(body)
      return await agentDataService.createAgent(parsed)
    },

    PATCH: async ({ body }) => {
      const parsed = ReorderAgentsSchema.parse(body)
      await agentDataService.reorderAgents(parsed.orderedIds)
      return undefined
    }
  },

  '/agents/:id': {
    GET: async ({ params }) => {
      return await agentDataService.getAgent(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentSchema.parse(body)
      return await agentDataService.updateAgent(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await agentDataService.deleteAgent(params.id)
      return undefined
    }
  },

  '/agents/:agentId/sessions': {
    GET: async ({ params, query }) => {
      return await agentDataService.listSessions(params.agentId, query)
    },

    POST: async ({ params, body }) => {
      const parsed = CreateAgentSessionSchema.parse(body)
      return await agentDataService.createSession(params.agentId, parsed)
    },

    PATCH: async ({ params, body }) => {
      const parsed = ReorderAgentsSchema.parse(body)
      await agentDataService.reorderSessions(params.agentId, parsed.orderedIds)
      return undefined
    }
  },

  '/agents/:agentId/sessions/:id': {
    GET: async ({ params }) => {
      return await agentDataService.getSession(params.agentId, params.id)
    },

    DELETE: async ({ params }) => {
      await agentDataService.deleteSession(params.agentId, params.id)
      return undefined
    }
  },

  '/agents/:agentId/sessions/:sessionId/messages': {
    GET: async ({ params }) => {
      return await agentDataService.getSessionMessages(params.agentId, params.sessionId)
    }
  }
}
