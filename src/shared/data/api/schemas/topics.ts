/**
 * Topic API Schema definitions
 *
 * Contains all topic-related endpoints for CRUD, duplication, branch switching, and ordering.
 * Entity schemas and types live in `@shared/data/types/topic`.
 */

import * as z from 'zod'

import { type Topic, TopicNameSchema, TopicSchema } from '../../types/topic'
import type { CursorPaginationResponse } from '../types'
import { type OrderEndpoints, OrderRequestSchema } from './_endpointHelpers'

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
    assistantId: z.string().nullable().optional()
  })
export type UpdateTopicDto = z.infer<typeof UpdateTopicSchema>

/** Atomic owner change plus placement in the one global topic order. */
export const MoveTopicSchema = z.strictObject({
  assistantId: z.uuidv4().nullable(),
  order: OrderRequestSchema
})
export type MoveTopicDto = z.infer<typeof MoveTopicSchema>

/**
 * Owner scope for topic list/stats filters: a concrete assistant id, or the
 * literal `'unlinked'` for topics with no live owner (`assistantId IS NULL` or
 * the referenced assistant is soft-deleted). Assistant ids are UUIDs, so the
 * sentinel cannot collide with a real id.
 */
export const TopicOwnerScopeSchema = z.union([z.uuidv4(), z.literal('unlinked')])
export type TopicOwnerScope = z.infer<typeof TopicOwnerScopeSchema>

/**
 * Sort profiles for `GET /topics` (D1 of #16890). Direction is derived
 * server-side from the profile — there is no caller-controlled `sortOrder`:
 * - `createdAt` → creation order (`createdAt DESC, id ASC`)
 * - `updatedAt` → activity order (`updatedAt DESC, id ASC`)
 * - `orderKey` → manual drag order (`orderKey ASC, id ASC`)
 */
export const TopicSortBySchema = z.enum(['createdAt', 'updatedAt', 'orderKey'])
export type TopicSortBy = z.infer<typeof TopicSortBySchema>

/** Topic lists expose only pin identity; pin order remains an internal cursor key. */
export type TopicListItem = Topic & { pinned: boolean; pinId: string | null }

const hasRecordFilters = (q: { assistantId?: string; pinned?: boolean; ids?: string[] }) =>
  q.assistantId !== undefined || q.pinned !== undefined || q.ids !== undefined

/**
 * Query parameters for `GET /topics`.
 *
 * `pinned=true` selects a pin-owned stream ordered by `pin.orderKey ASC`; its
 * order is independent of the topic sort profile. Otherwise, without `sortBy`
 * the response is the legacy composite view (pinned first by `pin.orderKey`,
 * then unpinned by `topic.orderKey ASC`) and only `q` is accepted. With
 * `sortBy` the response is a single flat stream with a `(sortValue, id)`
 * keyset cursor, and the record filters below apply.
 */
export const ListTopicsQuerySchema = z
  .strictObject({
    /** Opaque cursor from previous page's `nextCursor`. Valid only with the same filter+sort query. */
    cursor: z.string().optional(),
    /** Page size; defaults to 50 in the service. */
    limit: z.coerce.number().int().positive().max(200).optional(),
    /** Substring filter on topic name (case-insensitive LIKE). */
    q: z.string().optional(),
    /** Sort profile; omitted with pinned=true → pin order, otherwise the legacy composite view. */
    sortBy: TopicSortBySchema.optional(),
    /** Owner scope: concrete assistant id, or 'unlinked' (`assistantId IS NULL`). */
    assistantId: TopicOwnerScopeSchema.optional(),
    /** true → pin-owned stream; false → only unpinned topics (requires sortBy). Omitted → both. */
    pinned: z.boolean().optional(),
    /** Bounded explicit id filter for locating known topic rows. */
    ids: z.array(z.string().min(1)).min(1).max(200).optional()
  })
  .refine((q) => q.sortBy !== undefined || q.pinned === true || !hasRecordFilters(q), {
    message: 'record filters (assistantId/pinned/ids) require sortBy unless pinned=true'
  })
export type ListTopicsQuery = z.infer<typeof ListTopicsQuerySchema>

/**
 * Query parameters for `GET /topics/stats`. Only filters used by current
 * aggregation consumers are exposed; pagination, pin state and bounded id
 * lookup remain list-only concerns.
 */
export const TopicStatsQuerySchema = z.strictObject({
  q: z.string().optional(),
  assistantId: TopicOwnerScopeSchema.optional()
})
export type TopicStatsQuery = z.infer<typeof TopicStatsQuerySchema>

export interface CountWithPins {
  count: number
  pinnedCount: number
}

/**
 * Response for `GET /topics/stats`. Factual aggregation only — the renderer
 * derives display counts (e.g. ordinary group count = `count - pinnedCount`).
 * `byAssistant` is an array so the unlinked scope (`assistantId: null`) is
 * representable. Stats and list calls are separate SQLite snapshots; transient
 * disagreement during concurrent mutation is reconciled by invalidation.
 */
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

/** Response for `GET /topics/latest` — the globally most-recently-updated topic, or `null` when empty. */
export interface LatestTopicResponse {
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
   * @example GET /topics?limit=50
   * @example GET /topics?cursor=...&q=search
   * @example POST /topics { "name": "New Topic", "assistantId": "asst_123" }
   * @example DELETE /topics?ids=topic_1,topic_2
   */
  '/topics': {
    /**
     * List topics with cursor pagination + optional name search.
     *
     * The list is a server-composed view: pinned topics first (joining the
     * `pin` table on `entityType = 'topic'` ordered by `pin.orderKey`), then
     * unpinned topics ordered by `topic.orderKey ASC, id ASC` (manual/creation
     * order + id tiebreak). The cursor encodes the section + last boundary so
     * paging across the boundary is seamless.
     */
    GET: {
      query?: ListTopicsQuery
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
   * Most-recently-updated topic across all assistants.
   *
   * First-entry restore reads this to resume the last-touched conversation.
   * Declared before `/topics/:id` and matched exactly by the server router, so
   * `latest` is never mistaken for a topic id. Proves global latest via
   * `updatedAt DESC LIMIT 1`, unlike the pinned-first `/topics` first page.
   *
   * @example GET /topics/latest
   */
  '/topics/latest': {
    GET: {
      response: LatestTopicResponse
    }
  }

  /**
   * Factual aggregation over topics (D3 of #16890): totals, pinned counts, and
   * per-assistant breakdowns under the same record filters as the list.
   * Declared before `/topics/:id` and matched exactly by the server router, so
   * `stats` is never mistaken for a topic id.
   *
   * @example GET /topics/stats
   * @example GET /topics/stats?assistantId=unlinked
   */
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
