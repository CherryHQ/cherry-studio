/**
 * Knowledge API Handlers
 *
 * Implements knowledge base and item endpoints for DataApi v2.
 */

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { KnowledgeSchemas } from '@shared/data/api/schemas/knowledges'

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
  '/knowledge-bases': {
    GET: async () => {
      return await knowledgeBaseService.list()
    },
    POST: async ({ body }) => {
      return await knowledgeBaseService.create(body)
    }
  },

  '/knowledge-bases/:id': {
    GET: async ({ params }) => {
      return await knowledgeBaseService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      return await knowledgeBaseService.update(params.id, body)
    },
    DELETE: async ({ params }) => {
      await knowledgeBaseService.delete(params.id)
      return undefined
    }
  },

  '/knowledge-bases/:id/items': {
    GET: async ({ params }) => {
      return await knowledgeItemService.list(params.id)
    },
    POST: async ({ params, body }) => {
      return await knowledgeItemService.create(params.id, body)
    }
  },

  '/knowledge-items/:id': {
    GET: async ({ params }) => {
      return await knowledgeItemService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      return await knowledgeItemService.update(params.id, body)
    },
    DELETE: async ({ params }) => {
      await knowledgeItemService.delete(params.id)
      return undefined
    }
  },

  '/knowledge-items/:id/reprocess': {
    POST: async ({ params }) => {
      return await knowledgeItemService.reprocess(params.id)
    }
  },

  '/knowledge-bases/:id/search': {
    GET: async ({ params, query }) => {
      return await knowledgeBaseService.search(params.id, query)
    }
  }
}
