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
  '/knowledge-bases': {
    GET: async ({ query }) => {
      return await knowledgeService.listBases(query ?? {})
    },
    POST: async ({ body }) => {
      return await knowledgeService.createBase(body)
    }
  },

  '/knowledge-bases/:id': {
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

  '/knowledge-bases/:id/items': {
    GET: async ({ params, query }) => {
      return await knowledgeService.listItems(params.id, query ?? {})
    },
    POST: async ({ params, body }) => {
      return await knowledgeService.createItem(params.id, body)
    }
  },

  '/knowledge-bases/:id/items/batch': {
    POST: async ({ params, body }) => {
      return await knowledgeService.createItemsBatch(params.id, body)
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

  '/knowledge-items/:id/refresh': {
    POST: async ({ params }) => {
      return await knowledgeService.refreshItem(params.id)
    }
  },

  '/knowledge-items/:id/cancel': {
    POST: async ({ params }) => {
      return await knowledgeService.cancelItem(params.id)
    }
  },

  '/knowledge-bases/:id/search': {
    POST: async ({ params, body }) => {
      return await knowledgeService.search(params.id, body)
    }
  }
}
