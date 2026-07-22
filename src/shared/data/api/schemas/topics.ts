/**
 * Topic API Schema definitions
 *
 * Contains all topic-related endpoints for CRUD, duplication, branch switching, and ordering.
 * Entity schemas and types live in `@shared/data/types/topic`.
 */

import * as z from 'zod'

import { AssistantIdSchema } from '../../types/assistant'
import { type Topic, TopicNameSchema, TopicSchema } from '../../types/topic'
import type { CursorPaginationResponse } from '../types'
import type { OrderEndpoints } from './_endpointHelpers'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new topic.
 */
export const CreateTopicSchema = TopicSchema.pick({
  name: true,
  assistantId: true
}).partial()
export type CreateTopicDto = z.infer<typeof CreateTopicSchema>

/**
 * DTO for updating an existing topic.
 *
 * Pin state and ordering are NOT updated through this DTO:
 * - Pin/unpin: `POST /pins` / `DELETE /pins/:id`
 * - Reorder: `PATCH /topics/:id/order` (see `OrderEndpoints`)
 */
export const UpdateTopicSchema = TopicSchema.pick({
  name: true,
  isNameManuallyEdited: true
})
  .partial()
  .extend({
    assistantId: AssistantIdSchema.nullable().optional()
  })
export type UpdateTopicDto = z.infer<typeof UpdateTopicSchema>

/** Atomically move a topic to a live Assistant at one visible-neighbour position. */
export const MoveTopicSchema = z.strictObject({
  assistantId: AssistantIdSchema,
  order: z.union([z.strictObject({ before: z.string().min(1) }), z.strictObject({ after: z.string().min(1) })])
})
export type MoveTopicDto = z.infer<typeof MoveTopicSchema>

/** A concrete live Assistant id, or the reserved unlinked-owner scope. */
export const TopicOwnerScopeSchema = z.union([AssistantIdSchema, z.literal('unlinked')])
export type TopicOwnerScope = z.infer<typeof TopicOwnerScopeSchema>

/** Fixed sort profiles: timestamps descend and `orderKey` ascends, so callers do not supply `sortOrder`. */
export const TopicSortBySchema = z.enum(['createdAt', 'lastActivityAt', 'orderKey'])
export type TopicSortBy = z.infer<typeof TopicSortBySchema>

export const TopicSearchScopeSchema = z.enum(['name', 'name-or-owner'])
export type TopicSearchScope = z.infer<typeof TopicSearchScopeSchema>

/** Collection projection; pin ordering remains internal to the pin stream. */
export type TopicListItem = Topic & { pinned: boolean; pinId: string | null }

/**
 * Query parameters for `GET /topics`.
 *
 * Two independent streams that never mix in one response or cursor:
 * - `pinned=true` uses persisted pin order and does not accept `sortBy`.
 * - `pinned=false` excludes pinned rows and uses the requested sort profile.
 */
const ListTopicsCommonQuerySchema = z.strictObject({
  /** Opaque cursor from previous page's `nextCursor`. */
  cursor: z.string().optional(),
  /** Page size; defaults to 50 in the service. */
  limit: z.coerce.number().int().positive().max(200).optional(),
  /** Literal substring search term (`%`, `_`, and `\\` are escaped). */
  q: z.string().optional(),
  /** Search topic name only, or topic/owning-live-Assistant name. */
  searchScope: TopicSearchScopeSchema.optional(),
  /** Concrete live Assistant id, or `unlinked`. */
  assistantId: TopicOwnerScopeSchema.optional()
})

export const ListTopicsQuerySchema = z.discriminatedUnion('pinned', [
  ListTopicsCommonQuerySchema.extend({
    pinned: z.literal(true)
  }),
  ListTopicsCommonQuerySchema.extend({
    pinned: z.literal(false),
    sortBy: TopicSortBySchema.optional()
  })
])
export type ListTopicsQueryParams = z.input<typeof ListTopicsQuerySchema>
export type ListTopicsQuery = z.output<typeof ListTopicsQuerySchema>

export const LatestTopicQuerySchema = z.strictObject({
  assistantId: TopicOwnerScopeSchema.optional()
})
export type LatestTopicQuery = z.infer<typeof LatestTopicQuerySchema>

/**
 * Exact owner target for reusable empty-topic lookup. `unassigned` means
 * `assistantId IS NULL` only; unlike the list's `unlinked` aggregate it does
 * not include topics whose former assistant was soft-deleted.
 */
export const ReusableTopicPlaceholderQuerySchema = z.strictObject({
  assistantId: z.union([AssistantIdSchema, z.literal('unassigned')])
})
export type ReusableTopicPlaceholderQuery = z.infer<typeof ReusableTopicPlaceholderQuerySchema>

export const TopicStatsQuerySchema = z.strictObject({
  q: z.string().optional(),
  assistantId: TopicOwnerScopeSchema.optional()
})
export type TopicStatsQuery = z.infer<typeof TopicStatsQuerySchema>

export interface CountWithPins {
  count: number
  pinnedCount: number
}

export interface TopicStats {
  total: number
  pinnedCount: number
  byAssistant: Array<{ assistantId: string | null } & CountWithPins>
}

/**
 * DTO for setting active node. Pins the exact `nodeId` — the conversation
 * view truncates there; the user's next message forks the tree.
 *
 * Note: a navigator-style `descend` flag (walk down to a leaf before pinning)
 * lives on `DeJeune/ai-service` along with its renderer consumers
 * (`MessageGroup.tsx`, `SiblingNavigator.tsx`). It will be reintroduced when
 * that branch lands; shipping the flag without consumers leaves an unreachable
 * contract surface.
 */
export const SetActiveNodeSchema = z.strictObject({
  /** Node ID to set as active */
  nodeId: z.string().min(1)
})
export type SetActiveNodeDto = z.infer<typeof SetActiveNodeSchema>

/**
 * DTO for duplicating a topic path into a new topic.
 *
 * Current contract:
 * - `nodeId` copies only the root-to-node path into the new topic and drops
 *   siblings / descendants outside that path.
 * - `name` lets the renderer pass a localized duplicate title; when omitted,
 *   the service falls back to the source topic name.
 *
 * Intended evolution:
 * - Omit `nodeId`: duplicate the whole topic with all branches.
 * - Add `sourceNodeId`: copy the subpath from `sourceNodeId` to `nodeId`.
 * - For in-place edit/resend branching, use `POST /messages/:id/siblings`.
 */
export const DuplicateTopicSchema = z.strictObject({
  /** Message node to copy up to. Must belong to the source topic. */
  nodeId: z.string().min(1),
  /** Optional localized name for the duplicated topic. */
  name: z.string().trim().pipe(TopicNameSchema).optional()
})
export type DuplicateTopicDto = z.infer<typeof DuplicateTopicSchema>

/**
 * Response for active node update
 */
export interface ActiveNodeResponse {
  /** The new active node ID */
  activeNodeId: string
}

export interface DeleteTopicsResult {
  deletedIds: string[]
  deletedCount: number
}

/** Most-recently-active topic in the requested owner scope, or `null`. */
export interface LatestTopicResponse {
  topic: Topic | null
}

/** The newest reusable empty topic for the exact creation owner, or `null`. */
export interface ReusableTopicPlaceholderResponse {
  topic: Topic | null
}

const DeleteTopicsIdsQueryValueSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string().min(1)).min(1))

export const DeleteTopicsQuerySchema = z.strictObject({
  ids: DeleteTopicsIdsQueryValueSchema
})
export type DeleteTopicsQuery = z.input<typeof DeleteTopicsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Topic API Schema definitions.
 *
 * Reorder endpoints (`/topics/:id/order`, `/topics/order:batch`) are injected
 * via `& OrderEndpoints<'/topics'>`. Topic order is global across assistants;
 * callers only provide the relative anchor.
 */
export type TopicSchemas = {
  /**
   * Topics collection endpoint
   * @example GET /topics?pinned=false&limit=50
   * @example GET /topics?pinned=true&cursor=...
   * @example POST /topics { "name": "New Topic", "assistantId": "asst_123" }
   * @example DELETE /topics?ids=topic_1,topic_2
   */
  '/topics': {
    /**
     * Explicit `pinned=true/false` requests use independent streams. Omitting
     * the flag preserves the existing composed view until the renderer moves.
     */
    GET: {
      query?: ListTopicsQueryParams
      response: CursorPaginationResponse<TopicListItem>
    }
    /** Create a new topic. */
    POST: {
      body: CreateTopicDto
      response: Topic
    }
    /**
     * Delete an explicit set of topics.
     *
     * Used by multi-select table flows where the selection can span assistants.
     * This operation is all-or-nothing: if any supplied ID does not resolve to
     * a non-deleted topic, the request fails and no selected topics are deleted.
     */
    DELETE: {
      query: DeleteTopicsQuery
      response: DeleteTopicsResult
    }
  }

  /**
   * Most-recently-active topic globally or within one owner scope.
   *
   * First-entry restore reads this to resume the last-touched conversation.
   * Declared before `/topics/:id` and matched exactly by the server router, so
   * `latest` is never mistaken for a topic id. Proves global latest via
   * `lastActivityAt DESC LIMIT 1`, independent of list ordering.
   *
   * @example GET /topics/latest
   */
  '/topics/latest': {
    GET: {
      query?: LatestTopicQuery
      response: LatestTopicResponse
    }
  }

  /**
   * Newest structurally empty, untitled placeholder for one exact creation
   * owner. This derived read is independent of list pagination and pin order.
   */
  '/topics/reusable-placeholder': {
    GET: {
      query: ReusableTopicPlaceholderQuery
      response: ReusableTopicPlaceholderResponse
    }
  }

  /** Factual totals, pin counts, and per-Assistant breakdowns. */
  '/topics/stats': {
    GET: {
      query?: TopicStatsQuery
      response: TopicStats
    }
  }

  /**
   * Individual topic endpoint
   * @example GET /topics/abc123
   * @example PATCH /topics/abc123 { "name": "Updated Name" }
   * @example DELETE /topics/abc123
   */
  '/topics/:id': {
    /** Get a topic by ID */
    GET: {
      params: { id: string }
      response: Topic
    }
    /** Update a topic */
    PATCH: {
      params: { id: string }
      body: UpdateTopicDto
      response: Topic
    }
    /** Delete a topic and all its messages */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /** Atomically change owner and place the topic beside a target-owner topic. */
  '/topics/:id/move': {
    POST: {
      params: { id: string }
      body: MoveTopicDto
      response: void
    }
  }

  /**
   * Active node sub-resource endpoint
   * High-frequency operation for branch switching
   * @example PUT /topics/abc123/active-node { "nodeId": "msg456" }
   */
  '/topics/:id/active-node': {
    /** Set the active node for a topic */
    PUT: {
      params: { id: string }
      body: SetActiveNodeDto
      response: ActiveNodeResponse
    }
  }

  /**
   * Duplicate action endpoint.
   *
   * Creates a new topic by copying the source topic's root → `nodeId` message
   * path. The copied topic's active node is the copied `nodeId`.
   *
   * @example POST /topics/abc123/duplicate { "nodeId": "msg456", "name": "Source (Copy)" }
   */
  '/topics/:id/duplicate': {
    POST: {
      params: { id: string }
      body: DuplicateTopicDto
      response: Topic
    }
  }

  /**
   * Delete all topics currently linked to an assistant.
   *
   * This is an explicit scoped collection delete. It does not change
   * the default `DELETE /assistants/:id` behavior, which only deletes the
   * assistant itself unless the caller opts into `deleteTopics=true`.
   */
  '/assistants/:assistantId/topics': {
    DELETE: {
      params: { assistantId: string }
      response: DeleteTopicsResult
    }
  }
} & OrderEndpoints<'/topics'>
