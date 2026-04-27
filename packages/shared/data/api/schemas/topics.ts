/**
 * Topic API Schema definitions
 *
 * Contains all topic-related endpoints for CRUD operations and branch switching.
 * Entity schemas and types live in `@shared/data/types/topic`.
 */

import * as z from 'zod'

import { type Topic, TopicSchema } from '../../types/topic'
import type { CursorPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new topic.
 *
 * `sourceNodeId` is a transient request-only field (not a Topic column): when
 * present, the service copies the path from root to this node into the new
 * topic — so it lives outside the entity pick set.
 */
export const CreateTopicSchema = TopicSchema.pick({
  name: true,
  assistantId: true,
  groupId: true
})
  .partial()
  .extend({
    /** Source node ID for fork operation. */
    sourceNodeId: z.string().optional()
  })
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
  isNameManuallyEdited: true,
  assistantId: true,
  groupId: true
}).partial()
export type UpdateTopicDto = z.infer<typeof UpdateTopicSchema>

/**
 * Query parameters for `GET /topics` (cursor pagination + search).
 */
export const ListTopicsQuerySchema = z.strictObject({
  /** Opaque cursor from previous page's `nextCursor`. */
  cursor: z.string().optional(),
  /** Page size; defaults to 50 in the service. */
  limit: z.coerce.number().int().positive().max(200).optional(),
  /** Substring filter on topic name (case-insensitive LIKE). */
  q: z.string().optional()
})
export type ListTopicsQuery = z.infer<typeof ListTopicsQuerySchema>

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
 * Response for active node update
 */
export interface ActiveNodeResponse {
  /** The new active node ID */
  activeNodeId: string
}

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Topic API Schema definitions.
 *
 * Reorder endpoints (`/topics/:id/order`, `/topics/order:batch`) are injected
 * via `& OrderEndpoints<'/topics'>`. The reorder is scoped by `groupId`
 * server-side; callers do not include the scope in the request body.
 */
export type TopicSchemas = {
  /**
   * Topics collection endpoint
   * @example GET /topics?limit=50
   * @example GET /topics?cursor=...&q=search
   * @example POST /topics { "name": "New Topic", "assistantId": "asst_123" }
   */
  '/topics': {
    /**
     * List topics with cursor pagination + optional name search.
     *
     * The list is a server-composed view: pinned topics first (joining the
     * `pin` table on `entityType = 'topic'` ordered by `pin.orderKey`), then
     * unpinned topics ordered by `topic.orderKey`. Cursor encodes the section
     * + last orderKey so paging across the boundary is seamless.
     */
    GET: {
      query?: ListTopicsQuery
      response: CursorPaginationResponse<Topic>
    }
    /** Create a new topic (optionally fork from existing node) */
    POST: {
      body: CreateTopicDto
      response: Topic
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
} & OrderEndpoints<'/topics'>
