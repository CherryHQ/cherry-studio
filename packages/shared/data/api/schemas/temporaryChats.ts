/**
 * Temporary Chat API Schema definitions
 *
 * Contains endpoints for in-memory, non-persistent chat sessions that live on
 * the main process until the user explicitly persists or destroys them.
 *
 * All entity types (Topic, Message) and DTOs (CreateTopicDto, CreateMessageDto)
 * are reused from the persistent topic / message schemas. Fields that don't
 * apply to the linear, non-branching temporary model are rejected at the
 * service layer (see TemporaryChatService) — this schema does not narrow them
 * at the type level to keep full alignment with the persistent API surface.
 */

import type { Message } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'

import type { CreateMessageDto } from './messages'
import type { CreateTopicDto } from './topics'

// ============================================================================
// Responses
// ============================================================================

/**
 * Response for POST /temporary/topics/:id/persist
 */
export interface PersistTemporaryChatResponse {
  /** The persistent topic id (identical to the temporary id — no remapping) */
  topicId: string
  /** Number of messages written to the persistent DB */
  messageCount: number
}

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Temporary Chat API Schema definitions.
 *
 * Mirrors a strict subset of the persistent topic / message API:
 * - POST   /temporary/topics
 * - DELETE /temporary/topics/:id
 * - POST   /temporary/topics/:topicId/messages
 * - GET    /temporary/topics/:topicId/messages
 * - POST   /temporary/topics/:id/persist
 *
 * Endpoints deliberately NOT provided (and their rationale):
 * - GET /temporary/topics/:id                — create response already carries full Topic
 * - PATCH /temporary/topics/:id              — no rename / reassign in temporary chats
 * - PUT /temporary/topics/:id/active-node    — no activeNode concept
 * - GET /temporary/topics/:topicId/tree      — no tree structure
 * - GET /messages/:id, PATCH, DELETE         — messages are immutable once appended
 */
export interface TemporaryChatSchemas {
  /**
   * Temporary topics collection endpoint
   * @example POST /temporary/topics { "name": "Quick question", "assistantId": "asst_123" }
   */
  '/temporary/topics': {
    /** Create a new temporary topic. `sourceNodeId` is rejected (fork not supported). */
    POST: {
      body: CreateTopicDto
      response: Topic
    }
  }

  /**
   * Individual temporary topic endpoint
   * @example DELETE /temporary/topics/abc123
   */
  '/temporary/topics/:id': {
    /** Destroy a temporary topic and all its messages. Returns 404 when id is unknown. */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Messages collection for a temporary topic.
   * No pagination / cursor / siblings query params — returns the full linear array.
   * @example POST /temporary/topics/abc123/messages { "role": "user", "data": {...} }
   * @example GET  /temporary/topics/abc123/messages
   */
  '/temporary/topics/:topicId/messages': {
    /**
     * Append a message to a temporary topic.
     *
     * Rejected fields (throw validation errors):
     * - `parentId`       — temporary chats have no tree
     * - `siblingsGroupId` (non-zero) — no sibling branches
     * - `setAsActive`    — no activeNode concept
     * - `status === 'pending'` — must post completed messages only
     */
    POST: {
      params: { topicId: string }
      body: CreateMessageDto
      response: Message
    }
    /** Read the full linear message list for a temporary topic. */
    GET: {
      params: { topicId: string }
      response: Message[]
    }
  }

  /**
   * Persist endpoint — promote a temporary topic to a persistent topic.
   * The topic id does not change; the in-memory copy is discarded on success.
   * @example POST /temporary/topics/abc123/persist
   */
  '/temporary/topics/:id/persist': {
    POST: {
      params: { id: string }
      response: PersistTemporaryChatResponse
    }
  }
}
