/**
 * Assistant API Schema definitions
 *
 * Contains endpoints for Assistant CRUD operations and listing.
 * Entity schemas and types live in `@shared/data/types/assistant`.
 */

import * as z from 'zod'

import { type Assistant, AssistantSchema } from '../../types/assistant'
import { AutoFields } from '../../types/index'
import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// DTO Derivation
// ============================================================================

/**
 * DTO for creating a new assistant.
 * - `name` is required (non-empty)
 * - `mcpServerIds` / `knowledgeBaseIds` are synced to junction tables
 */
export const CreateAssistantSchema = AssistantSchema.omit(AutoFields).partial().required({ name: true })
export type CreateAssistantDto = z.infer<typeof CreateAssistantSchema>

/**
 * DTO for updating an existing assistant.
 * All fields optional, `id` excluded (comes from URL path).
 * Relation arrays (mcpServerIds, knowledgeBaseIds), if provided, replace existing junction table rows.
 */
export const UpdateAssistantSchema = AssistantSchema.omit(AutoFields).partial()
export type UpdateAssistantDto = z.infer<typeof UpdateAssistantSchema>

/**
 * Query parameters for listing assistants
 */
export const ListAssistantsQuerySchema = z.object({
  /** Filter by assistant ID */
  id: z.string().optional(),
  /** Page number (1-based, default: 1) */
  page: z.number().int().positive().optional(),
  /** Items per page (default: 100, max: 500) */
  limit: z.number().int().positive().max(500).optional()
})
export type ListAssistantsQuery = z.infer<typeof ListAssistantsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Assistant API Schema definitions
 */
export interface AssistantSchemas {
  /**
   * Assistants collection endpoint
   * @example GET /assistants
   * @example POST /assistants { "name": "My Assistant", "prompt": "You are helpful" }
   */
  '/assistants': {
    /** List all assistants with optional filters */
    GET: {
      query?: ListAssistantsQuery
      response: OffsetPaginationResponse<Assistant>
    }
    /** Create a new assistant */
    POST: {
      body: CreateAssistantDto
      response: Assistant
    }
  }

  /**
   * Individual assistant endpoint
   * @example GET /assistants/abc123
   * @example PATCH /assistants/abc123 { "name": "Updated Name" }
   * @example DELETE /assistants/abc123
   */
  '/assistants/:id': {
    /** Get an assistant by ID */
    GET: {
      params: { id: string }
      response: Assistant
    }
    /** Update an assistant */
    PATCH: {
      params: { id: string }
      body: UpdateAssistantDto
      response: Assistant
    }
    /** Delete an assistant */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
