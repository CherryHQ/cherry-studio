/**
 * Topic API Schema definitions
 *
 * Contains all topic-related endpoints for CRUD operations and branch switching.
 * Entity schemas and types live in `@shared/data/types/topic`.
 */

import * as z from 'zod'

import { type Topic, TopicSchema } from '../../types/topic'

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
 */
export const UpdateTopicSchema = TopicSchema.pick({
  name: true,
  isNameManuallyEdited: true,
  assistantId: true,
  groupId: true,
  sortOrder: true,
  isPinned: true,
  pinnedOrder: true
}).partial()
export type UpdateTopicDto = z.infer<typeof UpdateTopicSchema>

/**
 * DTO for setting active node.
 *
 * `descend` toggles two distinct behaviors:
 *   - `false` / omitted (default): pin the exact `nodeId`. The conversation
 *     view truncates there; the user's next message forks the tree.
 *   - `true`: walk down from `nodeId` to any leaf. Used by navigators that
 *     switch between sibling branches and want the full follow-up chain
 *     visible.
 */
export const SetActiveNodeSchema = z.strictObject({
  /** Node ID to set as active */
  nodeId: z.string().min(1),
  /** Whether to descend to a leaf under `nodeId` before pinning. */
  descend: z.boolean().optional()
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
 * Topic API Schema definitions
 */
export type TopicSchemas = {
  /**
   * Topics collection endpoint
   * @example POST /topics { "name": "New Topic", "assistantId": "asst_123" }
   */
  '/topics': {
    /** List non-deleted topics. */
    GET: {
      response: Topic[]
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
}
