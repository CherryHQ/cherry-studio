/**
 * Knowledge API Handlers.
 */

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { KnowledgeSchemas } from '@shared/data/api/schemas/knowledges'
import {
  CreateKnowledgeBaseSchema,
  CreateKnowledgeItemsSchema,
  KnowledgeBaseListQuerySchema,
  KnowledgeItemsQuerySchema,
  UpdateKnowledgeBaseSchema,
  UpdateKnowledgeItemSchema
} from '@shared/data/api/schemas/knowledges'

export const knowledgeHandlers: HandlersFor<KnowledgeSchemas> = {
  '/knowledge-bases': {
    GET: async ({ query }) => {
      const parsed = KnowledgeBaseListQuerySchema.parse(query ?? {})
      return await knowledgeBaseService.list(parsed)
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
      const parsed = KnowledgeItemsQuerySchema.parse(query ?? {})
      return await knowledgeItemService.list(params.id, parsed)
    },
    POST: async ({ params, body }) => {
      const parsed = CreateKnowledgeItemsSchema.parse(body)
      return await knowledgeItemService.createMany(params.id, parsed)
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
