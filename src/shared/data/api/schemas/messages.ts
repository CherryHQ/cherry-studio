/**
 * Message API Schema definitions
 *
 * Contains all message-related endpoints for tree operations and message management.
 * Includes endpoints for tree visualization and conversation view.
 */

import type { CursorPaginationParams } from '@shared/data/api/apiTypes'
import type { BranchMessagesResponse, Message, MessageData, TreeResponse } from '@shared/data/types/message'
import {
  ContentMessageRoleSchema,
  MessageDataSchema,
  MessageStatsSchema,
  MessageStatusSchema,
  ModelSnapshotSchema
} from '@shared/data/types/message'
import * as z from 'zod'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new message.
 *
 * Hand-written (not `MessageSchema.pick(...)`) because `parentId` has DTO-only
 * semantics — omitted means "auto-resolve", explicit `null` means "create as
 * root", a string means "attach to parent". The entity shape can't express
 * this three-way distinction, so the DTO is authored directly.
 */
export const CreateMessageSchema = z.strictObject({
  /**
   * Parent message ID for positioning this message in the conversation tree.
   *
   * Behavior (every topic owns a content-less virtual root; see message-tree.md):
   * - `undefined` (omitted): attach to `activeNodeId`, or to the virtual root on an
   *   empty topic (a first-turn message).
   * - `null` (explicit): first-turn message — resolved to the topic's virtual root, so
   *   first turns and their resends are ordinary siblings under it.
   * - `string` (message ID): Attach to specified parent. Throws NOT_FOUND if
   *   parent doesn't exist, or INVALID_OPERATION if parent belongs to a different topic.
   */
  parentId: z.string().nullable().optional(),
  /** Message role — content roles only; the virtual root is created internally, not via this DTO */
  role: ContentMessageRoleSchema,
  /** Message content */
  data: MessageDataSchema,
  /** Message status */
  status: MessageStatusSchema.optional(),
  /** Siblings group ID (0 = normal, >0 = multi-model group) */
  siblingsGroupId: z.number().optional(),
  /** Model identifier */
  modelId: z.string().optional(),
  /** Model snapshot captured at message creation time */
  modelSnapshot: ModelSnapshotSchema.optional(),
  /** Statistics */
  stats: MessageStatsSchema.optional(),
  /** Set this message as the active node in the topic (default: true) */
  setAsActive: z.boolean().optional()
})
export type CreateMessageDto = z.infer<typeof CreateMessageSchema>

/**
 * DTO for updating an existing message
 */
export const UpdateMessageSchema = z.strictObject({
  /** Updated message content */
  data: MessageDataSchema.optional(),
  /** Move message to new parent */
  parentId: z.string().nullable().optional(),
  /** Change siblings group */
  siblingsGroupId: z.number().optional(),
  /** Update status */
  status: MessageStatusSchema.optional(),
  /** Update statistics */
  stats: MessageStatsSchema.nullable().optional()
})
export type UpdateMessageDto = z.infer<typeof UpdateMessageSchema>

/**
 * Strategy for updating activeNodeId when the active message is deleted
 */
export const ActiveNodeStrategySchema = z.enum(['parent', 'clear'])
export type ActiveNodeStrategy = z.infer<typeof ActiveNodeStrategySchema>

/**
 * Response for delete operation
 */
export interface DeleteMessageResponse {
  /** IDs of deleted messages */
  deletedIds: string[]
  /** IDs of reparented children (only when cascade=false) */
  reparentedIds?: string[]
  /** New activeNodeId for the topic (only if activeNodeId was affected by deletion) */
  newActiveNodeId?: string | null
}

/**
 * Response for "clear all messages" — deletes every content message of a topic
 * (the virtual root's whole subtree) in one transaction, keeping the content-less
 * virtual root and clearing activeNodeId.
 */
export interface ClearTopicMessagesResponse {
  /** IDs of the deleted (live) messages */
  deletedIds: string[]
}

// ============================================================================
// Query Parameters
// ============================================================================

/**
 * Query parameters for GET /topics/:id/tree
 */
export const TreeQuerySchema = z.strictObject({
  /** Root node ID (defaults to tree root) */
  rootId: z.string().optional(),
  /** End node ID (defaults to topic.activeNodeId) */
  nodeId: z.string().optional(),
  /** Depth to expand beyond active path (-1 = all, 0 = path only, 1+ = layers) */
  depth: z.number().int().optional()
})
export type TreeQueryParams = z.infer<typeof TreeQuerySchema>

/**
 * Query parameters for GET /topics/:id/messages
 *
 * Uses "before cursor" semantics for loading historical messages:
 * - First request (no cursor): Returns the most recent `limit` messages
 * - Subsequent requests: Pass `nextCursor` from previous response as `cursor`
 *   to load older messages towards root
 * - The cursor message itself is NOT included in the response
 */
export const BranchMessagesQuerySchema = z.strictObject({
  /** Cursor for pagination (exclusive boundary) */
  cursor: z.string().optional(),
  /** Page size */
  limit: z.number().int().positive().optional(),
  /** End node ID (defaults to topic.activeNodeId) */
  nodeId: z.string().optional(),
  /** Whether to include siblingsGroup in response */
  includeSiblings: z.boolean().optional()
})
export type BranchMessagesQueryParams = z.infer<typeof BranchMessagesQuerySchema> & CursorPaginationParams

/**
 * Query parameters for DELETE /messages/:id
 */
export const DeleteMessageQuerySchema = z.strictObject({
  cascade: z.boolean().optional(),
  activeNodeStrategy: ActiveNodeStrategySchema.optional()
})
export type DeleteMessageQuery = z.infer<typeof DeleteMessageQuerySchema>

/**
 * Query parameters for GET /topics/:topicId/path
 */
export const PathThroughQuerySchema = z.strictObject({
  /** Node the returned path must pass through. */
  nodeId: z.string().min(1)
})
export type PathThroughQueryParams = z.infer<typeof PathThroughQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Message API Schema definitions
 *
 * Organized by domain responsibility:
 * - /topics/:id/tree - Tree visualization
 * - /topics/:id/messages - Branch messages for conversation
 * - /messages/:id - Individual message operations
 */
export type MessageSchemas = {
  /**
   * Tree query endpoint for visualization
   * @example GET /topics/abc123/tree?depth=1
   */
  '/topics/:topicId/tree': {
    /** Get tree structure for visualization */
    GET: {
      params: { topicId: string }
      query?: TreeQueryParams
      response: TreeResponse
    }
  }

  /**
   * Branch messages endpoint for conversation view
   * @example GET /topics/abc123/messages?limit=20
   * @example POST /topics/abc123/messages { "parentId": "msg1", "role": "user", "data": {...} }
   */
  '/topics/:topicId/messages': {
    /** Get messages along active branch with pagination */
    GET: {
      params: { topicId: string }
      query?: BranchMessagesQueryParams
      response: BranchMessagesResponse
    }
    /** Create a new message in the topic */
    POST: {
      params: { topicId: string }
      body: CreateMessageDto
      response: Message
    }
    /** Clear all of the topic's messages, keeping the (content-less) virtual root */
    DELETE: {
      params: { topicId: string }
      response: ClearTopicMessagesResponse
    }
  }

  /**
   * Read-only path query passing through a given node.
   *
   * Returns root → leaf where leaf is the most recently created live
   * descendant of `nodeId` (or `nodeId` itself if it has no live children).
   * Does not modify topic state — use PUT /topics/:id/active-node to
   * persist a chosen path.
   *
   * @example GET /topics/abc123/path?nodeId=msg42
   */
  '/topics/:topicId/path': {
    GET: {
      params: { topicId: string }
      query: PathThroughQueryParams
      response: Message[]
    }
  }

  /**
   * Individual message endpoint
   * @example GET /messages/msg123
   * @example PATCH /messages/msg123 { "data": {...} }
   * @example DELETE /messages/msg123?cascade=true
   */
  '/messages/:id': {
    /** Get a single message by ID */
    GET: {
      params: { id: string }
      response: Message
    }
    /** Update a message (content, move to new parent, etc.) */
    PATCH: {
      params: { id: string }
      body: UpdateMessageDto
      response: Message
    }
    /**
     * Delete a message
     * - cascade=true: deletes message and all descendants
     * - cascade=false: reparents children to grandparent
     * - activeNodeStrategy='parent' (default): sets activeNodeId to parent if affected
     * - activeNodeStrategy='clear': sets activeNodeId to null if affected
     */
    DELETE: {
      params: { id: string }
      query?: DeleteMessageQuery
      response: DeleteMessageResponse
    }
  }

  /**
   * Siblings sub-resource of a message — POST creates a new sibling under the
   * same parent (edit-and-resend branching flow).
   *
   * Atomically (single DB transaction):
   * 1. If the source has `siblingsGroupId = 0`, allocate a new group id and
   *    backfill the source so it and the new sibling belong to the same group.
   * 2. Insert the new message with `parentId = source.parentId`, the shared
   *    `siblingsGroupId`, and `role = source.role`.
   * 3. Set the topic's `activeNodeId` to the new message.
   *
   * @example POST /messages/msg123/siblings { "data": { "parts": [...] } }
   */
  '/messages/:id/siblings': {
    POST: {
      params: { id: string }
      body: MessageData
      response: Message
    }
  }
}
