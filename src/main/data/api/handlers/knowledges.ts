/**
 * Knowledge API Handlers
 *
 * Implements knowledge base and item endpoints for DataApi v2.
 */

import { knowledgeService } from '@data/services/KnowledgeService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { KnowledgeSchemas } from '@shared/data/api/schemas/knowledge'

/**
 * Handler type for a specific knowledge endpoint.
 */
type KnowledgeHandler<Path extends keyof KnowledgeSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Knowledge API handlers implementation.
 */
export const knowledgeHandlers: {
  [Path in keyof KnowledgeSchemas]: {
    [Method in keyof KnowledgeSchemas[Path]]: KnowledgeHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/knowledges': {
    GET: async ({ query }) => {
      return await knowledgeService.listBases(query ?? {})
    },
    POST: async ({ body }) => {
      return await knowledgeService.createBase(body)
    }
  },

  '/knowledges/:id': {
    GET: async ({ params }) => {
      return await knowledgeService.getBaseById(params.id)
    },
    PATCH: async ({ params, body }) => {
      return await knowledgeService.updateBase(params.id, body)
    },
    DELETE: async ({ params }) => {
      await knowledgeService.deleteBase(params.id)
      return undefined
    }
  },

  '/knowledges/:id/items': {
    GET: async ({ params, query }) => {
      return await knowledgeService.listItems(params.id, query ?? {})
    },
    POST: async ({ params, body }) => {
      return await knowledgeService.createItems(params.id, body)
    }
  },

  '/knowledge-items/:id': {
    GET: async ({ params }) => {
      return await knowledgeService.getItemById(params.id)
    },
    PATCH: async ({ params, body }) => {
      return await knowledgeService.updateItem(params.id, body)
    },
    DELETE: async ({ params }) => {
      await knowledgeService.deleteItem(params.id)
      return undefined
    }
  },

  '/knowledges/:id/search': {
    POST: async ({ params, body }) => {
      return await knowledgeService.search(params.id, body)
    }
  }
}
