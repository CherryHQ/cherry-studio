/**
 * Topic API Schema definitions
 *
 * Contains all topic-related endpoints for CRUD operations and branch switching.
 */

import type { AssistantMeta } from '@shared/data/types/meta'
import type { Topic } from '@shared/data/types/topic'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new topic
 */
export interface CreateTopicDto {
  /** Topic name */
  name?: string
  /** Associated assistant ID */
  assistantId?: string
  /** Preserved assistant info */
  assistantMeta?: AssistantMeta
  /** Topic-specific prompt */
  prompt?: string
  /** Group ID for organization */
  groupId?: string
  /**
   * Source node ID for fork operation.
   * When provided, copies the path from root to this node into the new topic.
   */
  sourceNodeId?: string
}

/**
 * DTO for updating an existing topic
 */
export interface UpdateTopicDto {
  /** Updated topic name */
  name?: string
  /** Mark name as manually edited */
  isNameManuallyEdited?: boolean
  /** Updated assistant ID */
  assistantId?: string
  /** Updated assistant meta */
  assistantMeta?: AssistantMeta
  /** Updated prompt */
  prompt?: string
  /** Updated group ID */
  groupId?: string
  /** Updated sort order */
  sortOrder?: number
  /** Updated pin state */
  isPinned?: boolean
  /** Updated pin order */
  pinnedOrder?: number
}

/**
 * DTO for setting active node
 */
export interface SetActiveNodeDto {
  /** Node ID to set as active */
  nodeId: string
}

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
export interface TopicSchemas {
  /**
   * Topics collection endpoint
   * @example POST /topics { "name": "New Topic", "assistantId": "asst_123" }
   */
  '/topics': {
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
