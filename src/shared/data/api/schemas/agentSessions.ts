/**
 * Agent session domain API Schema definitions.
 */

import {
  MessageDataSchema,
  MessageRoleSchema,
  MessageStatsSchema,
  MessageStatusSchema,
  ModelSnapshotSchema
} from '@shared/data/types/message'
import { TraceIdSchema } from '@shared/data/types/trace'
import * as z from 'zod'

import type { CursorPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'
import { AgentNameAtomSchema } from './agents'
import { AgentSessionWorkspaceSourceSchema, AgentWorkspaceEntitySchema } from './agentWorkspaces'

/** Cursor-paginated query for `/agent-sessions/:sessionId/messages`. Walks history
 *  newest-first; an absent `cursor` returns the most recent page, then each
 *  `nextCursor` walks one page older. Limit caps at 200 — the renderer
 *  flattens with `useInfiniteFlatItems` and the virtualizer scrolls older
 *  pages in on demand, so per-page size never has to cover a whole session. */
export const AGENT_SESSION_MESSAGES_MAX_LIMIT = 200
export const AGENT_SESSION_MESSAGES_DEFAULT_LIMIT = 50

export const AgentSessionMessagesListQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(AGENT_SESSION_MESSAGES_MAX_LIMIT).optional()
})
export type AgentSessionMessagesListQuery = z.infer<typeof AgentSessionMessagesListQuerySchema>

// ============================================================================
// Entity & DTOs (Rule C: derive DTOs via .pick())
// ============================================================================

const AgentSessionMessageBaseSchema = z.strictObject({
  role: MessageRoleSchema,
  data: MessageDataSchema,
  status: MessageStatusSchema,
  modelId: z.string().nullable(),
  modelSnapshot: ModelSnapshotSchema.nullable(),
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
  modelSnapshot: true,
  stats: true
})
  .partial()
  .extend({
    id: z.string().optional(),
    role: MessageRoleSchema,
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

export const AgentSessionEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string().nullable(),
  name: AgentNameAtomSchema,
  description: z.string().optional(),
  workspaceId: z.string(),
  workspace: AgentWorkspaceEntitySchema,
  /** Container-level OTel trace id — one trace tree per session. */
  traceId: TraceIdSchema.optional(),
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

// Create requires a real `agentId` — orphans only happen via cascade, never on insert.
export const CreateAgentSessionSchema = z.strictObject({
  agentId: z.string().min(1),
  name: AgentNameAtomSchema,
  description: z.string().optional(),
  workspace: AgentSessionWorkspaceSourceSchema
})
export type CreateAgentSessionDto = z.infer<typeof CreateAgentSessionSchema>

export const UpdateAgentSessionSchema = z.strictObject({
  name: AgentNameAtomSchema.optional(),
  description: z.string().optional(),
  agentId: z.string().min(1).optional()
})

export type UpdateAgentSessionDto = z.infer<typeof UpdateAgentSessionSchema>

/** Query for `GET /agent-sessions` (cursor pagination + optional agent filter). */
export const ListAgentSessionsQuerySchema = z.strictObject({
  agentId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
})
export type ListAgentSessionsQueryParams = z.input<typeof ListAgentSessionsQuerySchema>
export type ListAgentSessionsQuery = z.output<typeof ListAgentSessionsQuerySchema>

export interface DeleteAgentSessionsResult {
  deletedIds: string[]
}

export const AGENT_SESSION_DELETE_MAX_IDS = 200

const DeleteAgentSessionsIdsQueryValueSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string().min(1)).min(1).max(AGENT_SESSION_DELETE_MAX_IDS))

export const DeleteAgentSessionsQuerySchema = z.strictObject({
  ids: DeleteAgentSessionsIdsQueryValueSchema
})
export type DeleteAgentSessionsQueryParams = z.input<typeof DeleteAgentSessionsQuerySchema>

// ============================================================================
// API Schema definitions
// ============================================================================

export type AgentSessionSchemas = {
  '/agent-sessions': {
    GET: {
      query?: ListAgentSessionsQueryParams
      response: CursorPaginationResponse<AgentSessionEntity>
    }
    POST: {
      body: CreateAgentSessionDto
      response: AgentSessionEntity
    }
    /**
     * Delete an explicit set of sessions. Missing ids are ignored so overlapping
     * multi-window deletes remain idempotent; `deletedIds` reports what was
     * actually removed.
     *
     * Cascades: session pins are purged; if a requested session is backed by a
     * system workspace, that backing workspace row is removed too.
     */
    DELETE: {
      query: DeleteAgentSessionsQueryParams
      response: DeleteAgentSessionsResult
    }
  }

  '/agent-sessions/:sessionId': {
    GET: {
      params: { sessionId: string }
      response: AgentSessionEntity
    }
    PATCH: {
      params: { sessionId: string }
      body: UpdateAgentSessionDto
      response: AgentSessionEntity
    }
    /**
     * Delete one session.
     *
     * Cascades: session pins are purged; if the session is backed by a system
     * workspace, that backing workspace row is removed too.
     */
    DELETE: {
      params: { sessionId: string }
      response: void
    }
  }

  '/agent-sessions/:sessionId/messages': {
    GET: {
      params: { sessionId: string }
      query?: AgentSessionMessagesListQuery
      response: CursorPaginationResponse<z.infer<typeof AgentSessionMessageEntitySchema>>
    }
  }

  '/agent-sessions/:sessionId/messages/:messageId': {
    DELETE: {
      params: { sessionId: string; messageId: string }
      response: void
    }
  }
  '/agents/:agentId/sessions': {
    /**
     * Delete every session belonging to an agent (all-or-nothing — missing agent → NOT_FOUND).
     *
     * Cascades: session pins are purged; system workspaces backing deleted
     * sessions are removed too.
     */
    DELETE: {
      params: { agentId: string }
      response: DeleteAgentSessionsResult
    }
  }
} & OrderEndpoints<'/agent-sessions'>
