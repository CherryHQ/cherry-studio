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

import * as z from 'zod'

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeChunkGovernanceService } from '@data/services/KnowledgeChunkGovernanceService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { KnowledgeSchemas } from '@shared/data/api/schemas/knowledges'
import {
  ListKnowledgeBasesQuerySchema,
  ListKnowledgeItemsQuerySchema,
  ReorderKnowledgeBaseSchema,
  UpdateKnowledgeBaseSchema
} from '@shared/data/api/schemas/knowledges'
import type { HandlersFor } from '@shared/data/api/types'
import { KnowledgeChunkHistoryQuerySchema } from '@shared/data/types/knowledgeChunkGovernance'

export const knowledgeHandlers: HandlersFor<KnowledgeSchemas> = {
  '/knowledge-bases/:baseId/items/:itemId/chunks/:unitId/history': {
    GET: async ({ params, query }) => {
      const scope = z
        .strictObject({ baseId: z.uuid(), itemId: z.uuid(), unitId: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(params)
      return knowledgeChunkGovernanceService.readHistoryPage(
        scope.baseId,
        scope.itemId,
        scope.unitId,
        KnowledgeChunkHistoryQuerySchema.parse(query ?? {})
      )
    }
  },

  '/knowledge-bases': {
    GET: async ({ query }) => {
      const parsed = ListKnowledgeBasesQuerySchema.parse(query ?? {})
      return knowledgeBaseService.listCursor(parsed)
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

  '/knowledge-bases/:id/order': {
    PATCH: async ({ params, body }) => {
      knowledgeBaseService.reorder(params.id, ReorderKnowledgeBaseSchema.parse(body))
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
