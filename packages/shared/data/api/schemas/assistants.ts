/**
 * Assistant API Schema definitions
 *
 * Contains endpoints for Assistant CRUD operations and listing.
 * Entity schemas and types live in `@shared/data/types/assistant`.
 */

import * as z from 'zod'

import { type Assistant, AssistantSchema, AssistantSettingsSchema } from '../../types/assistant'
import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// DTO Derivation
// ============================================================================

/**
 * Mutable assistant fields — explicit whitelist of everything a client may write.
 * Anything not listed here (id, createdAt, updatedAt, future auto-managed columns)
 * is rejected at the API boundary by default.
 */
const ASSISTANT_MUTABLE_FIELDS = {
  name: true,
  prompt: true,
  emoji: true,
  description: true,
  settings: true,
  modelId: true,
  mcpServerIds: true,
  knowledgeBaseIds: true
} as const

/**
 * DTO for creating a new assistant.
 * - `name` is required (non-empty)
 * - `mcpServerIds` / `knowledgeBaseIds` are synced to junction tables
 */
export const CreateAssistantSchema = AssistantSchema.pick(ASSISTANT_MUTABLE_FIELDS).partial().required({ name: true })
export type CreateAssistantDto = z.infer<typeof CreateAssistantSchema>

/**
 * DTO for updating an existing assistant. All fields optional.
 *
 * `settings` itself is a deep partial — clients can change a single setting
 * without re-sending (and re-validating) the others. The service layer merges
 * the partial onto the persisted settings object before writing back. This
 * keeps a corrupt-but-historically-tolerated field (e.g. `maxTokens: 0`)
 * from blocking unrelated updates.
 *
 * Relation arrays (`mcpServerIds`, `knowledgeBaseIds`), if provided, replace
 * existing junction table rows.
 */
export const UpdateAssistantSchema = AssistantSchema.pick(ASSISTANT_MUTABLE_FIELDS)
  .partial()
  .extend({ settings: AssistantSettingsSchema.partial().optional() })
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
export type AssistantSchemas = {
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
