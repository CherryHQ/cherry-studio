/**
 * Group API Schema definitions
 *
 * Contains endpoints for Group CRUD and scoped reorder operations.
 * Entity schemas and types live in `@shared/data/types/group`.
 */

import * as z from 'zod'

import { EntityTypeSchema } from '../../types/entityType'
import { type Group, GroupIdSchema as SharedGroupIdSchema, GroupNameSchema } from '../../types/group'
import type { OrderEndpoints } from './_endpointHelpers'

export const GroupIdSchema = SharedGroupIdSchema

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new group.
 * `entityType` is locked at creation time (read-only afterwards).
 */
export const CreateGroupSchema = z.strictObject({
  entityType: EntityTypeSchema,
  name: GroupNameSchema
})
export type CreateGroupDto = z.infer<typeof CreateGroupSchema>

/**
 * DTO for updating an existing group. Only `name` is mutable.
 */
export const UpdateGroupSchema = z.strictObject({
  name: GroupNameSchema.optional()
})
export type UpdateGroupDto = z.infer<typeof UpdateGroupSchema>

/**
 * Query params for `GET /groups`. `entityType` is required — listing across
 * entity types has no business use case.
 */
export const ListGroupsQuerySchema = z.strictObject({
  entityType: EntityTypeSchema
})
export type ListGroupsQuery = z.infer<typeof ListGroupsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Group API Schema definitions
 */
export type GroupSchemas = {
  /**
   * Groups collection endpoint
   * @example GET /groups?entityType=topic
   * @example POST /groups { "entityType": "topic", "name": "Research" }
   */
  '/groups': {
    /** List groups within a given entityType, ordered by orderKey */
    GET: {
      query: ListGroupsQuery
      response: Group[]
    }
    /** Create a new group; appended to the end of its entityType bucket */
    POST: {
      body: CreateGroupDto
      response: Group
    }
  }

  /**
   * Individual group endpoint
   * @example GET /groups/abc123
   * @example PATCH /groups/abc123 { "name": "Renamed" }
   * @example DELETE /groups/abc123
   */
  '/groups/:id': {
    /** Get a group by ID */
    GET: {
      params: { id: string }
      response: Group
    }
    /** Update a group's mutable fields */
    PATCH: {
      params: { id: string }
      body: UpdateGroupDto
      response: Group
    }
    /** Delete a group */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
} & OrderEndpoints<'/groups'>
