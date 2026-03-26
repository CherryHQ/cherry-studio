/**
 * Knowledge API Handlers.
 */

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { KnowledgeItemsQueryParams, KnowledgeSchemas } from '@shared/data/api/schemas/knowledges'
import { KNOWLEDGE_ITEMS_DEFAULT_LIMIT, KNOWLEDGE_ITEMS_DEFAULT_PAGE } from '@shared/data/api/schemas/knowledges'

type KnowledgeHandler<Path extends keyof KnowledgeSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

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
    GET: async ({ params, query }) => {
      const q = (query || {}) as KnowledgeItemsQueryParams
      return await knowledgeItemService.list(params.id, {
        page: q.page ?? KNOWLEDGE_ITEMS_DEFAULT_PAGE,
        limit: q.limit ?? KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
        parentId: q.parentId?.trim() || undefined
      })
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
  }
}
