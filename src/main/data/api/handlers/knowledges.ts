/**
 * Knowledge API Handlers
 *
 * Implements the SQLite-backed knowledge endpoints:
 * - Knowledge base list/detail reads
 * - Knowledge base metadata/config updates
 * - Knowledge item reads within a base or by item id
 *
 * DataApi only exposes operations that are satisfied by the database layer.
 * Runtime/index mutations that create, delete, or rebuild vector-store
 * artifacts are coordinated by `KnowledgeOrchestrationService` instead.
 */

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { KnowledgeSchemas } from '@shared/data/api/schemas/knowledges'
import {
  ListKnowledgeBasesQuerySchema,
  ListKnowledgeItemsQuerySchema,
  UpdateKnowledgeBaseSchema
} from '@shared/data/api/schemas/knowledges'

export const knowledgeHandlers: HandlersFor<KnowledgeSchemas> = {
  '/knowledge-bases': {
    GET: async ({ query }) => {
      const parsed = ListKnowledgeBasesQuerySchema.parse(query ?? {})
      return await knowledgeBaseService.list(parsed)
    }
  },

  '/knowledge-bases/:id': {
    GET: async ({ params }) => {
      return await knowledgeBaseService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateKnowledgeBaseSchema.parse(body)
      return await knowledgeBaseService.update(params.id, parsed)
    }
  },

  '/knowledge-bases/:id/items': {
    GET: async ({ params, query }) => {
      const parsed = ListKnowledgeItemsQuerySchema.parse(query ?? {})
      return await knowledgeItemService.list(params.id, parsed)
    }
  },

  '/knowledge-items/:id': {
    GET: async ({ params }) => {
      return await knowledgeItemService.getById(params.id)
    }
  }
}
