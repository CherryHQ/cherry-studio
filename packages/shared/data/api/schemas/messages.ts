/**
 * Message API Schema definitions
 *
 * Contains all message-related endpoints for tree operations and message management.
 * Includes endpoints for tree visualization and conversation view.
 */

import type {
  BranchMessagesResponse,
  Message,
  MessageData,
  MessageRole,
  MessageStats,
  MessageStatus,
  TreeResponse
} from '@shared/data/types/message'
import type { AssistantMeta, ModelMeta } from '@shared/data/types/meta'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new message
 */
export interface CreateMessageDto {
  /** Parent message ID (null for root) */
  parentId: string | null
  /** Message role */
  role: MessageRole
  /** Message content */
  data: MessageData
  /** Message status */
  status?: MessageStatus
  /** Siblings group ID (0 = normal, >0 = multi-model group) */
  siblingsGroupId?: number
  /** Assistant ID */
  assistantId?: string
  /** Preserved assistant info */
  assistantMeta?: AssistantMeta
  /** Model identifier */
  modelId?: string
  /** Preserved model info */
  modelMeta?: ModelMeta
  /** Trace ID */
  traceId?: string
  /** Statistics */
  stats?: MessageStats
}

/**
 * DTO for updating an existing message
 */
export interface UpdateMessageDto {
  /** Updated message content */
  data?: MessageData
  /** Move message to new parent */
  parentId?: string | null
  /** Change siblings group */
  siblingsGroupId?: number
  /** Update status */
  status?: MessageStatus
}

/**
 * Response for delete operation
 */
export interface DeleteMessageResponse {
  /** IDs of deleted messages */
  deletedIds: string[]
  /** IDs of reparented children (only when cascade=false) */
  reparentedIds?: string[]
}

// ============================================================================
// Query Parameters
// ============================================================================

/**
 * Query parameters for GET /topics/:id/tree
 */
export interface TreeQueryParams {
  /** Root node ID (defaults to tree root) */
  rootId?: string
  /** End node ID (defaults to topic.activeNodeId) */
  nodeId?: string
  /** Depth to expand beyond active path (-1 = all, 0 = path only, 1+ = layers) */
  depth?: number
}

/**
 * Query parameters for GET /topics/:id/messages
 */
export interface BranchMessagesQueryParams {
  /** End node ID (defaults to topic.activeNodeId) */
  nodeId?: string
  /** Pagination cursor: return messages before this node */
  beforeNodeId?: string
  /** Number of messages to return */
  limit?: number
  /** Whether to include siblingsGroup in response */
  includeSiblings?: boolean
}

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
export interface MessageSchemas {
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
    /** Delete a message (cascade=true deletes descendants, cascade=false reparents children) */
    DELETE: {
      params: { id: string }
      query?: { cascade?: boolean }
      response: DeleteMessageResponse
    }
  }
}
