/**
 * Assistant API Schema definitions
 *
 * Contains endpoints for Assistant CRUD operations and listing.
 * Entity schemas and types live in `@shared/data/types/assistant`.
 */

import * as z from 'zod'

import { type Assistant, AssistantSchema, AssistantSettingsSchema } from '../../types/assistant'
import { TagIdSchema } from '../../types/tag'
import type { OffsetPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'

// ============================================================================
// DTO Derivation
// ============================================================================

/**
 * Mutable assistant fields — explicit whitelist of everything a client may write.
 * Anything not listed here (id, createdAt, updatedAt, tags, modelName, future
 * auto-managed columns) is rejected at the API boundary by default.
 *
 * Not in the whitelist:
 * - `tags` is embedded on read via inline join; writes use `tagIds` below.
 * - `modelName` is resolved at read time from `user_model.name`; edits go via
 *   `modelId`.
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
 * Shared tag-binding field for Create / Update DTOs.
 * Semantics mirror `mcpServerIds`/`knowledgeBaseIds`:
 *   - `undefined` → leave existing bindings untouched
 *   - `[]`        → clear all bindings
 *   - `[...ids]`  → replace bindings with this exact set
 */
const TagIdsField = z.array(TagIdSchema).optional()

/**
 * DTO for creating a new assistant.
 * - `name` is required (non-empty)
 * - `mcpServerIds` / `knowledgeBaseIds` / `tagIds` are synced to junction tables
 */
export const CreateAssistantSchema = AssistantSchema.pick(ASSISTANT_MUTABLE_FIELDS)
  .partial()
  .required({ name: true })
  .extend({ tagIds: TagIdsField })
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
 * Relation arrays (`mcpServerIds`, `knowledgeBaseIds`, `tagIds`), if provided,
 * replace existing junction table rows. Update picks directly from the entity,
 * not Create, so Create defaults do not bleed into partial updates.
 */
export const UpdateAssistantSchema = AssistantSchema.pick(ASSISTANT_MUTABLE_FIELDS)
  .partial()
  .extend({ settings: AssistantSettingsSchema.partial().optional(), tagIds: TagIdsField })
export type UpdateAssistantDto = z.infer<typeof UpdateAssistantSchema>

export const ASSISTANTS_DEFAULT_PAGE = 1
export const ASSISTANTS_DEFAULT_LIMIT = 100
export const ASSISTANTS_MAX_LIMIT = 500

/**
 * Query parameters for listing assistants.
 *
 * Filtering semantics:
 * - `search` performs a case-insensitive LIKE match against `name` OR
 *   `description`. Wildcards (`%` / `_`) typed by the user are escaped server
 *   side — matches the `SearchParams` convention in `apiTypes.ts` and the
 *   search naming rule in `api-design-guidelines.md`.
 * - `tagIds` filters to assistants bound to ANY of the given tags (union /
 *   OR semantics — matches the resource-library chip picker).
 * - `search` and `tagIds` compose with AND (tag-scoped keyword search).
 */
export const ListAssistantsQuerySchema = z.object({
  /** Filter by assistant ID */
  id: z.string().optional(),
  /** Free-text match against name OR description (case-insensitive LIKE) */
  search: z.string().trim().min(1).optional(),
  /** Return assistants bound to ANY of these tag ids (union) */
  tagIds: z.array(TagIdSchema).min(1).optional(),
  /** Positive integer, defaults to {@link ASSISTANTS_DEFAULT_PAGE} */
  page: z.int().positive().default(ASSISTANTS_DEFAULT_PAGE),
  /** Positive integer, max {@link ASSISTANTS_MAX_LIMIT}, defaults to {@link ASSISTANTS_DEFAULT_LIMIT} */
  limit: z.int().positive().max(ASSISTANTS_MAX_LIMIT).default(ASSISTANTS_DEFAULT_LIMIT)
})
/**
 * Renderer-facing query params (schema input — `page`/`limit` are optional,
 * filled by `.parse()` at the handler boundary).
 * Follows the `{...QueryParams, ...Query}` split used by KnowledgeService.
 */
export type ListAssistantsQueryParams = z.input<typeof ListAssistantsQuerySchema>
/**
 * Service-facing query (schema output — defaults guaranteed filled).
 */
export type ListAssistantsQuery = z.output<typeof ListAssistantsQuerySchema>

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
      query?: ListAssistantsQueryParams
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
} & OrderEndpoints<'/assistants'>
