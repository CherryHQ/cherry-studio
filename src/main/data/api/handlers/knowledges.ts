/**
 * Knowledge API Handlers
 *
 * Implements the SQLite-backed knowledge endpoints:
 * - Knowledge base list/detail reads
 * - Knowledge base metadata/config updates
 * - Knowledge item reads within a base or by item id
 *
 * DataApi only exposes operations that are satisfied by the database layer.
 * Runtime/index mutations that create, delete, restore, or reindex vector-store
 * artifacts are coordinated by `KnowledgeService` instead.
 */

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { KnowledgeSchemas } from '@shared/data/api/schemas/knowledges'
import {
  ListKnowledgeBasesQuerySchema,
  ListKnowledgeItemsQuerySchema,
  UpdateKnowledgeBaseSchema
} from '@shared/data/api/schemas/knowledges'
import type { HandlersFor } from '@shared/data/api/types'

export const knowledgeHandlers: HandlersFor<KnowledgeSchemas> = {
  '/knowledge-bases': {
    GET: async ({ query }) => {
      const parsed = ListKnowledgeBasesQuerySchema.parse(query ?? {})
      return knowledgeBaseService.list(parsed)
    }
  },

  '/knowledge-bases/:id': {
    GET: async ({ params }) => {
      return knowledgeBaseService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateKnowledgeBaseSchema.parse(body)
      return knowledgeBaseService.update(params.id, parsed)
    }
  },

  '/knowledge-bases/:id/items': {
    GET: async ({ params, query }) => {
      const parsed = ListKnowledgeItemsQuerySchema.parse(query ?? {})
      return knowledgeItemService.list(params.id, parsed)
    }
  },

  '/knowledge-items/:id': {
    GET: async ({ params }) => {
      return knowledgeItemService.getById(params.id)
    }
  }
}
