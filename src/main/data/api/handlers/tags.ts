/**
 * Tag API Handlers
 *
 * Implements all tag-related API endpoints including:
 * - Tag CRUD operations
 * - Entity-tag association management
 *
 * All input validation happens here at the system boundary.
 */

import { tagDataService } from '@data/services/TagService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { TagSchemas } from '@shared/data/api/schemas/tags'
import {
  CreateTagSchema,
  SetTagEntitiesSchema,
  SyncEntityTagsSchema,
  UpdateTagSchema
} from '@shared/data/api/schemas/tags'
import { TaggableEntityType } from '@shared/data/types/tag'

/**
 * Handler type for a specific tag endpoint
 */
type TagHandler<Path extends keyof TagSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Tag API handlers implementation
 */
export const tagHandlers: {
  [Path in keyof TagSchemas]: {
    [Method in keyof TagSchemas[Path]]: TagHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/tags': {
    GET: async () => {
      return await tagDataService.list()
    },

    POST: async ({ body }) => {
      const parsed = CreateTagSchema.parse(body)
      return await tagDataService.create(parsed)
    }
  },

  '/tags/:id': {
    GET: async ({ params }) => {
      return await tagDataService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateTagSchema.parse(body)
      return await tagDataService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await tagDataService.delete(params.id)
      return undefined
    }
  },

  '/tags/:id/entities': {
    PUT: async ({ params, body }) => {
      const parsed = SetTagEntitiesSchema.parse(body)
      await tagDataService.setEntities(params.id, parsed)
      return undefined
    }
  },

  '/tags/entities/:entityType/:entityId': {
    GET: async ({ params }) => {
      const entityType = TaggableEntityType.parse(params.entityType)
      return await tagDataService.getTagsByEntity(entityType, params.entityId)
    },

    PUT: async ({ params, body }) => {
      const entityType = TaggableEntityType.parse(params.entityType)
      const parsed = SyncEntityTagsSchema.parse(body)
      await tagDataService.syncEntityTags(entityType, params.entityId, parsed)
      return undefined
    }
  }
}
