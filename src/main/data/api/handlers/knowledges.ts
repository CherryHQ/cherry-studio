/**
 * Knowledge API Handlers.
 */

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { KnowledgeSchemas } from '@shared/data/api/schemas/knowledges'
import {
  CreateKnowledgeBaseSchema,
  CreateKnowledgeRootChildrenSchema,
  KnowledgeBaseListQuerySchema,
  KnowledgeItemChildrenQuerySchema,
  KnowledgeRootChildrenQuerySchema,
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

  '/knowledge-bases/:id/root/children': {
    GET: async ({ params, query }) => {
      const parsed = KnowledgeRootChildrenQuerySchema.parse(query ?? {})
      return await knowledgeItemService.listRootChildren(params.id, parsed)
    },
    POST: async ({ params, body }) => {
      const parsed = CreateKnowledgeRootChildrenSchema.parse(body)
      return await knowledgeItemService.createRootChildren(params.id, parsed)
    }
  },

  '/knowledge-items/:id/children': {
    GET: async ({ params, query }) => {
      const parsed = KnowledgeItemChildrenQuerySchema.parse(query ?? {})
      return await knowledgeItemService.listChildren(params.id, parsed)
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
