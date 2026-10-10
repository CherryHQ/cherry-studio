/**
 * Pin API Schema definitions
 *
 * Contains endpoints for Pin CRUD and scoped reorder operations.
 * Entity schemas and types live in `@shared/data/types/pin`.
 *
 * Note: there is no PATCH on `/pins/:id` — pins have no mutable business
 * fields. `entityType` / `entityId` are immutable after creation, timestamps
 * are auto, and `id` is auto.
 */

import * as z from 'zod'

import { EntityIdSchema, EntityTypeSchema } from '../../types/entityType'
import { type Pin, PinIdSchema as SharedPinIdSchema } from '../../types/pin'
import type { OrderEndpoints } from './_endpointHelpers'

export const PinIdSchema = SharedPinIdSchema

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating (or re-using) a pin. Idempotent: when a pin already exists
 * for the same (entityType, entityId) the service returns the existing row.
 */
export const CreatePinSchema = z.strictObject({
  entityType: EntityTypeSchema,
  entityId: EntityIdSchema
})
export type CreatePinDto = z.infer<typeof CreatePinSchema>

/**
 * Query params for `GET /pins`. `entityType` is required — listing across
 * entity types has no business use case.
 */
export const ListPinsQuerySchema = z.strictObject({
  entityType: EntityTypeSchema
})
export type ListPinsQuery = z.infer<typeof ListPinsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Pin API Schema definitions
 */
export type PinSchemas = {
  /**
   * Pins collection endpoint
   * @example GET /pins?entityType=topic
   * @example POST /pins { "entityType": "topic", "entityId": "..." }
   */
  '/pins': {
    /** List pins within a given entityType, ordered by orderKey */
    GET: {
      query: ListPinsQuery
      response: Pin[]
    }
    /** Idempotent pin: returns the existing row when already pinned */
    POST: {
      body: CreatePinDto
      response: Pin
    }
  }

  /**
   * Individual pin endpoint
   * @example GET /pins/abc123
   * @example DELETE /pins/abc123
   */
  '/pins/:id': {
    /** Get a pin by ID */
    GET: {
      params: { id: string }
      response: Pin
    }
    /** Unpin (hard delete by pin id) */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
} & OrderEndpoints<'/pins'>
