/**
 * Knowledge API Handlers.
 */

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import {
  CreateKnowledgeBaseSchema,
  CreateKnowledgeItemsSchema,
  type KnowledgeSchemas,
  UpdateKnowledgeBaseSchema,
  UpdateKnowledgeItemSchema
} from '@shared/data/api/schemas/knowledges'

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
      const parsed = CreateKnowledgeBaseSchema.parse(body)
      return await knowledgeBaseService.create(parsed)
    }
  },

  '/knowledge-bases/:id': {
    GET: async ({ params }) => {
      return await knowledgeBaseService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateKnowledgeBaseSchema.parse(body)
      return await knowledgeBaseService.update(params.id, parsed)
    },
    DELETE: async ({ params }) => {
      await knowledgeBaseService.delete(params.id)
      return undefined
    }
  },

  '/knowledge-bases/:id/items': {
    GET: async ({ params, query }) => {
      const q = (query || {}) as { parentId?: string }
      const parentId = q.parentId?.trim() ? q.parentId : undefined
      return await knowledgeItemService.list(params.id, parentId)
    },
    POST: async ({ params, body }) => {
      const parsed = CreateKnowledgeItemsSchema.parse(body)
      return await knowledgeItemService.create(params.id, parsed)
    }
  },

  '/knowledge-items/:id': {
    GET: async ({ params }) => {
      return await knowledgeItemService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateKnowledgeItemSchema.parse(body)
      return await knowledgeItemService.update(params.id, parsed)
    },
    DELETE: async ({ params }) => {
      await knowledgeItemService.delete(params.id)
      return undefined
    }
  }
}
