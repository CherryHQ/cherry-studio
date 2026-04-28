/**
 * Tag API Handlers
 *
 * Implements all tag-related API endpoints including:
 * - Tag CRUD operations
 * - Entity-tag association management
 *
 * All input validation happens here at the system boundary.
 */

import { tagService } from '@data/services/TagService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { TagSchemas } from '@shared/data/api/schemas/tags'
import {
  CreateTagSchema,
  SetTagEntitiesSchema,
  SyncEntityTagsSchema,
  TaggableEntityTypeSchema,
  TagIdSchema,
  UpdateTagSchema
} from '@shared/data/api/schemas/tags'
import { EntityIdSchema } from '@shared/data/types/entityType'

export const tagHandlers: HandlersFor<TagSchemas> = {
  '/tags': {
    GET: async () => {
      return await tagService.list()
    },

    POST: async ({ body }) => {
      const parsed = CreateTagSchema.parse(body)
      return await tagService.create(parsed)
    }
  },

  '/tags/:id': {
    GET: async ({ params }) => {
      const id = TagIdSchema.parse(params.id)
      return await tagService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = TagIdSchema.parse(params.id)
      const parsed = UpdateTagSchema.parse(body)
      return await tagService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = TagIdSchema.parse(params.id)
      await tagService.delete(id)
      return undefined
    }
  },

  '/tags/:id/entities': {
    PUT: async ({ params, body }) => {
      const id = TagIdSchema.parse(params.id)
      const parsed = SetTagEntitiesSchema.parse(body)
      await tagService.setEntities(id, parsed)
      return undefined
    }
  },

  '/tags/entities/:entityType/:entityId': {
    GET: async ({ params }) => {
      const entityType = TaggableEntityTypeSchema.parse(params.entityType)
      const entityId = EntityIdSchema.parse(params.entityId)
      return await tagService.getTagsByEntity(entityType, entityId)
    },

    PUT: async ({ params, body }) => {
      const entityType = TaggableEntityTypeSchema.parse(params.entityType)
      const entityId = EntityIdSchema.parse(params.entityId)
      const parsed = SyncEntityTagsSchema.parse(body)
      await tagService.syncEntityTags(entityType, entityId, parsed)
      return undefined
    }
  }
}
