/**
 * Agent session message domain API Schema definitions.
 */

import {
  ContentMessageRoleSchema,
  MessageDataSchema,
  MessageSnapshotSchema,
  MessageStatsSchema,
  MessageStatusSchema
} from '@shared/data/types/message'
import * as z from 'zod'

import type { CursorPaginationResponse } from '../types'

/** Cursor-paginated query for `/agent-sessions/:sessionId/messages`. Walks history
 *  newest-first; an absent `cursor` returns the most recent page unless
 *  `messageId` anchors the first page at a known message, then each
 *  `nextCursor` walks one page older. Limit caps at 200 — the renderer
 *  flattens with `useInfiniteFlatItems` and the virtualizer scrolls older
 *  pages in on demand, so per-page size never has to cover a whole session.
 *  If `messageId` cannot be resolved inside the session, the endpoint falls
 *  back to the newest page. */
export const AGENT_SESSION_MESSAGES_MAX_LIMIT = 200
export const AGENT_SESSION_MESSAGES_DEFAULT_LIMIT = 50

export const AgentSessionMessagesListQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  messageId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(AGENT_SESSION_MESSAGES_MAX_LIMIT).optional()
})
export type AgentSessionMessagesListQuery = z.infer<typeof AgentSessionMessagesListQuerySchema>

// ============================================================================
// Entity & DTOs (Rule C: derive DTOs via .pick())
// ============================================================================

const AgentSessionMessageBaseSchema = z.strictObject({
  role: ContentMessageRoleSchema,
  data: MessageDataSchema,
  status: MessageStatusSchema,
  modelId: z.string().nullable(),
  messageSnapshot: MessageSnapshotSchema.nullable(),
  stats: MessageStatsSchema.nullable()
})

export const AgentSessionMessageEntitySchema = AgentSessionMessageBaseSchema.extend({
  /** Message ID (UUIDv7) */
  id: z.string(),
  /** Session ID this message belongs to */
  sessionId: z.string(),
  searchableText: z.string(),
  runtimeResumeToken: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type AgentSessionMessageEntity = z.infer<typeof AgentSessionMessageEntitySchema>

export const CreateAgentSessionMessageSchema = AgentSessionMessageBaseSchema.pick({
  modelId: true,
  messageSnapshot: true,
  stats: true
})
  .partial()
  .extend({
    id: z.string().optional(),
    role: ContentMessageRoleSchema,
    data: MessageDataSchema,
    status: MessageStatusSchema.optional()
  })
export type CreateAgentSessionMessageDto = z.infer<typeof CreateAgentSessionMessageSchema>

export const CreateAgentSessionMessagesSchema = z.strictObject({
  sessionId: z.string(),
  runtimeResumeToken: z.string().optional(),
  messages: z.array(CreateAgentSessionMessageSchema)
})
export type CreateAgentSessionMessagesDto = z.infer<typeof CreateAgentSessionMessagesSchema>

export const UpdateAgentSessionMessageSchema = AgentSessionMessageBaseSchema.pick({ data: true })
export type UpdateAgentSessionMessageDto = z.infer<typeof UpdateAgentSessionMessageSchema>

// ============================================================================
// API Schema definitions
// ============================================================================

export type AgentSessionMessageSchemas = {
  '/agent-sessions/:sessionId/messages': {
    GET: {
      params: { sessionId: string }
      query?: AgentSessionMessagesListQuery
      response: CursorPaginationResponse<z.infer<typeof AgentSessionMessageEntitySchema>>
    }
  }

  '/agent-sessions/:sessionId/messages/:messageId': {
    GET: {
      params: { sessionId: string; messageId: string }
      response: AgentSessionMessageEntity
    }
    PATCH: {
      params: { sessionId: string; messageId: string }
      body: UpdateAgentSessionMessageDto
      response: AgentSessionMessageEntity
    }
    DELETE: {
      params: { sessionId: string; messageId: string }
      response: void
    }
  }
}
