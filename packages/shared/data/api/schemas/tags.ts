/**
 * Tag API Schema definitions
 *
 * Contains endpoints for Tag CRUD and entity-tag association management.
 * Entity schemas and types live in `@shared/data/types/tag`.
 */

import * as z from 'zod'

import { EntityIdSchema, EntityTypeSchema } from '../../types/entityType'
import { type Tag, TagIdSchema as SharedTagIdSchema, TagSchema } from '../../types/tag'

export const TAG_ASSOCIATION_MAX_ITEMS = 100
export const TagIdSchema = SharedTagIdSchema
export const TaggableEntityTypeSchema = EntityTypeSchema.or(z.literal('skill'))
export type TaggableEntityType = z.infer<typeof TaggableEntityTypeSchema>

// ============================================================================
// DTO Derivation
// ============================================================================

/**
 * DTO for creating a new tag.
 * - `name` is required (unique)
 * - `color` is optional
 */
export const CreateTagSchema = TagSchema.pick({ name: true, color: true }).partial().required({ name: true })
export type CreateTagDto = z.infer<typeof CreateTagSchema>

/**
 * DTO for updating an existing tag. All fields optional, chain-derived from Create.
 */
export const UpdateTagSchema = CreateTagSchema.partial()
export type UpdateTagDto = z.infer<typeof UpdateTagSchema>

/**
 * Body for syncing tags on an entity (replace all tag associations)
 */
export const TagEntityRefSchema = z.object({
  entityType: TaggableEntityTypeSchema,
  entityId: EntityIdSchema
})

export const SyncEntityTagsSchema = z.object({
  tagIds: z
    .array(TagIdSchema)
    .max(TAG_ASSOCIATION_MAX_ITEMS)
    .refine((tagIds) => new Set(tagIds).size === tagIds.length, {
      message: 'Duplicate tag ids are not allowed'
    })
})
export type SyncEntityTagsDto = z.infer<typeof SyncEntityTagsSchema>

/**
 * Body for bulk setting entities on a tag
 */
export const SetTagEntitiesSchema = z.object({
  entities: z
    .array(TagEntityRefSchema)
    .max(TAG_ASSOCIATION_MAX_ITEMS)
    .refine(
      (entities) =>
        new Set(entities.map((entity) => `${entity.entityType}:${entity.entityId}`)).size === entities.length,
      { message: 'Duplicate entity bindings are not allowed' }
    )
})
export type SetTagEntitiesDto = z.infer<typeof SetTagEntitiesSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Tag API Schema definitions
 */
export type TagSchemas = {
  /**
   * Tags collection endpoint
   * @example GET /tags
   * @example POST /tags { "name": "work", "color": "#ff0000" }
   */
  '/tags': {
    /** List all tags */
    GET: {
      response: Tag[]
    }
    /** Create a new tag */
    POST: {
      body: CreateTagDto
      response: Tag
    }
  }

  /**
   * Individual tag endpoint
   * @example GET /tags/abc123
   * @example PATCH /tags/abc123 { "color": "#00ff00" }
   * @example DELETE /tags/abc123
   */
  '/tags/:id': {
    /** Get a tag by ID */
    GET: {
      params: { id: string }
      response: Tag
    }
    /** Update a tag */
    PATCH: {
      params: { id: string }
      body: UpdateTagDto
      response: Tag
    }
    /** Delete a tag (cascades to entity_tag associations) */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Bulk set entities for a specific tag
   * @example PUT /tags/abc123/entities { "entities": [{ "entityType": "assistant", "entityId": "xyz" }] }
   */
  '/tags/:id/entities': {
    PUT: {
      params: { id: string }
      body: SetTagEntitiesDto
      response: void
    }
  }

  /**
   * Entity-tag sub-resource: tags associated with a specific entity
   * @example GET /tags/entities/assistant/xyz
   * @example PUT /tags/entities/assistant/xyz { "tagIds": ["tag1", "tag2"] }
   */
  '/tags/entities/:entityType/:entityId': {
    /** Get all tags for an entity */
    GET: {
      params: { entityType: TaggableEntityType; entityId: string }
      response: Tag[]
    }
    /** Replace all tag associations for an entity */
    PUT: {
      params: { entityType: TaggableEntityType; entityId: string }
      body: SyncEntityTagsDto
      response: void
    }
  }
}
