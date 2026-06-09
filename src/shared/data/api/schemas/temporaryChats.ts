/**
 * Temporary runtime API schema definitions
 *
 * Contains endpoints for in-memory, non-persistent topics, messages, and
 * agent sessions that live on the main process until the caller explicitly
 * destroys them or hands their parameters to the runtime.
 *
 * All entity types (Topic, Message) and DTOs (CreateTopicDto, CreateMessageDto)
 * are reused from the persistent topic / message schemas. Fields that don't
 * apply to the linear, non-branching temporary model are rejected at the
 * service layer (see TemporaryChatService) - this schema does not narrow them
 * at the type level to keep full alignment with the persistent API surface.
 */

import type { Message } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import * as z from 'zod'

import { AgentSessionWorkspaceSourceSchema } from './agentWorkspaces'
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

export const TemporarySessionEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string(),
  workspaceSource: AgentSessionWorkspaceSourceSchema,
  createdAt: z.string(),
  updatedAt: z.string()
})
export type TemporarySessionEntity = z.infer<typeof TemporarySessionEntitySchema>

export const CreateTemporarySessionSchema = z.strictObject({
  agentId: z.string(),
  workspace: AgentSessionWorkspaceSourceSchema
})
export type CreateTemporarySessionDto = z.infer<typeof CreateTemporarySessionSchema>

export const UpdateTemporarySessionSchema = z
  .strictObject({
    agentId: z.string().optional(),
    workspace: AgentSessionWorkspaceSourceSchema.optional()
  })
  .refine((dto) => dto.agentId !== undefined || dto.workspace !== undefined, {
    message: 'at least one temporary session field is required'
  })
export type UpdateTemporarySessionDto = z.infer<typeof UpdateTemporarySessionSchema>

export const UpdateTemporaryTopicSchema = z
  .strictObject({
    assistantId: z.string().nullable().optional()
  })
  .refine((dto) => dto.assistantId !== undefined, {
    message: 'at least one temporary topic field is required'
  })
export type UpdateTemporaryTopicDto = z.infer<typeof UpdateTemporaryTopicSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Temporary runtime API schema definitions.
 *
 * Mirrors a strict subset of the persistent topic / message API:
 * - POST   /temporary/topics
 * - PATCH  /temporary/topics/:id
 * - DELETE /temporary/topics/:id
 * - POST   /temporary/topics/:topicId/messages
 * - GET    /temporary/topics/:topicId/messages
 * - POST   /temporary/topics/:id/persist
 * - POST   /temporary/sessions
 * - PATCH  /temporary/sessions/:id
 * - DELETE /temporary/sessions/:id
 * - POST   /temporary/sessions/:id/persist
 *
 * Endpoints deliberately NOT provided (and their rationale):
 * - GET /temporary/topics/:id                — create response already carries full Topic
 * - PUT /temporary/topics/:id/active-node    — no activeNode concept
 * - GET /temporary/topics/:topicId/tree      — no tree structure
 * - GET /messages/:id, PATCH, DELETE         — messages are immutable once appended
 * - GET /temporary/sessions/:id              — create response already carries full draft session
 * - GET /temporary/sessions                  — temporary sessions are scoped to caller-owned runtime state
 */
export type TemporaryChatSchemas = {
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
    /** Update the send context for an existing temporary topic without changing its id. */
    PATCH: {
      params: { id: string }
      body: UpdateTemporaryTopicDto
      response: Topic
    }
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

  '/temporary/sessions': {
    POST: {
      body: CreateTemporarySessionDto
      response: TemporarySessionEntity
    }
  }

  '/temporary/sessions/:id': {
    PATCH: {
      params: { id: string }
      body: UpdateTemporarySessionDto
      response: TemporarySessionEntity
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/temporary/sessions/:id/persist': {
    POST: {
      params: { id: string }
      response: TemporarySessionEntity
    }
  }
}
