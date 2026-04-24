/**
 * Group API Handlers
 *
 * Implements all group-related API endpoints:
 * - Group CRUD operations
 * - Scoped reorder endpoints (single + batch)
 *
 * All input validation happens here at the system boundary — handlers do not
 * perform row lookups or scope inference, those responsibilities belong to
 * `GroupService`.
 */

import { groupService } from '@data/services/GroupService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { GroupSchemas } from '@shared/data/api/schemas/groups'
import {
  CreateGroupSchema,
  GroupIdSchema,
  ListGroupsQuerySchema,
  UpdateGroupSchema
} from '@shared/data/api/schemas/groups'

export const groupHandlers: HandlersFor<GroupSchemas> = {
  '/groups': {
    GET: async ({ query }) => {
      const parsed = ListGroupsQuerySchema.parse(query)
      return await groupService.listByEntityType(parsed.entityType)
    },

    POST: async ({ body }) => {
      const parsed = CreateGroupSchema.parse(body)
      return await groupService.create(parsed)
    }
  },

  '/groups/:id': {
    GET: async ({ params }) => {
      const id = GroupIdSchema.parse(params.id)
      return await groupService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = GroupIdSchema.parse(params.id)
      const parsed = UpdateGroupSchema.parse(body)
      return await groupService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = GroupIdSchema.parse(params.id)
      await groupService.delete(id)
      return undefined
    }
  },

  '/groups/:id/order': {
    PATCH: async ({ params, body }) => {
      const id = GroupIdSchema.parse(params.id)
      const anchor = OrderRequestSchema.parse(body)
      await groupService.reorder(id, anchor)
      return undefined
    }
  },

  '/groups/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await groupService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
