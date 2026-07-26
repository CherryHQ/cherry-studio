/**
 * Assistant API Schema definitions
 *
 * Contains endpoints for Assistant CRUD operations and listing.
 * Entity schemas and types live in `@shared/data/types/assistant`.
 */

import * as z from 'zod'

import { type Assistant, AssistantSchema, AssistantSettingsSchema } from '../../types/assistant'
import { GroupIdSchema, GroupNameSchema } from '../../types/group'
import type { OffsetPaginationResponse } from '../types'
import type { OrderEndpoints } from './_endpointHelpers'

// ============================================================================
// DTO Derivation
// ============================================================================

/**
 * Mutable assistant fields — explicit whitelist of everything a client may edit.
 * Anything not listed here (id, createdAt, updatedAt, modelName, future
 * auto-managed columns) is rejected at the API boundary by default.
 *
 * Not in the whitelist:
 * - `modelName` is resolved at read time from `user_model.name`; edits go via
 *   `modelId`.
 * - `orderKey` is service-owned; writes go through `/assistants/:id/order`.
 */
const ASSISTANT_MUTABLE_FIELDS = {
  name: true,
  prompt: true,
  emoji: true,
  description: true,
  settings: true,
  modelId: true,
  groupId: true,
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
 * Legacy assistant import payload.
 *
 * The legacy file format only carries these assistant fields plus one optional
 * group name. Group resolution stays server-side so resolving/creating the
 * group and inserting the assistant can share one write transaction.
 * `GroupNameSchema` intentionally has no current-UI length cap: v1 exports may
 * contain tag names longer than 64 characters and must remain importable.
 */
export const ImportAssistantSchema = CreateAssistantSchema.pick({
  name: true,
  prompt: true,
  emoji: true,
  description: true,
  settings: true
}).extend({
  groupName: GroupNameSchema.optional()
})
export type ImportAssistantDto = z.infer<typeof ImportAssistantSchema>

/**
 * DTO for updating an existing assistant. All fields optional.
 *
 * `settings` itself is a deep partial — clients can change a single setting
 * without re-sending (and re-validating) the others. The service layer merges
 * the partial onto the persisted settings object before writing back. This
 * keeps a corrupt-but-historically-tolerated field (e.g. `maxTokens: 0`)
 * from blocking unrelated updates.
 *
 * Relation arrays (`mcpServerIds`, `knowledgeBaseIds`), if provided,
 * replace existing junction table rows. Update picks directly from the entity,
 * not Create, so Create defaults do not bleed into partial updates.
 */
export const UpdateAssistantSchema = AssistantSchema.pick(ASSISTANT_MUTABLE_FIELDS)
  .partial()
  .extend({ settings: AssistantSettingsSchema.partial().optional() })
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
 * - `groupId` filters to assistants assigned to that exact group.
 * - `search` and `groupId` compose with AND (group-scoped keyword search).
 */
export const ListAssistantsQuerySchema = z.strictObject({
  /** Filter by assistant ID */
  id: z.string().optional(),
  /** Free-text match against name OR description (case-insensitive LIKE) */
  search: z.string().trim().min(1).optional(),
  /** Return assistants assigned to this group */
  groupId: GroupIdSchema.optional(),
  /** Filter by assistant updatedAt timestamp, inclusive (`updatedAt >= updatedAtFrom`). */
  updatedAtFrom: z.iso.datetime().optional(),
  /** Sort field. Defaults to orderKey for library/resource ordering. */
  sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'orderKey']).optional(),
  /**
   * Sort direction. Defaults to asc for `orderKey`/`name`, desc otherwise.
   * `sortBy=updatedAt` intentionally bypasses pin ordering so freshness queries
   * return strictly by timestamp.
   */
  sortOrder: z.enum(['asc', 'desc']).optional(),
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

export const DeleteAssistantQuerySchema = z.strictObject({
  /**
   * Delete the assistant's topics in the same main-process transaction.
   * Omitted/false preserves the historical "delete assistant only" behavior.
   */
  deleteTopics: z.boolean().optional()
})
export type DeleteAssistantQueryParams = z.input<typeof DeleteAssistantQuerySchema>

export interface DeleteAssistantResult {
  deleted: boolean
  deletedTopicIds?: string[]
}

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
   * Import one assistant from the legacy preset shape. Group lookup/creation
   * and assistant creation are committed atomically.
   */
  '/assistants:import': {
    POST: {
      body: ImportAssistantDto
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
      query?: DeleteAssistantQueryParams
      response: DeleteAssistantResult
    }
  }
} & OrderEndpoints<'/assistants'>
