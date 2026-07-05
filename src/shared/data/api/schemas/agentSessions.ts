/**
 * Agent session domain API Schema definitions.
 */

import {
  ContentMessageRoleSchema,
  MessageDataSchema,
  MessageStatsSchema,
  MessageStatusSchema,
  ModelSnapshotSchema
} from '@shared/data/types/message'
import { TraceIdSchema } from '@shared/data/types/trace'
import * as z from 'zod'

import type { CursorPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'
import {
  type AgentSessionWorkspaceSource,
  AgentSessionWorkspaceSourceSchema,
  AgentWorkspaceEntitySchema
} from './agentWorkspaces'

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

/**
 * Session name validator. Empty is allowed for an untitled placeholder session,
 * and the length is capped at 255 — matching topic.name semantics
 * (`TopicNameEntitySchema`).
 */
export const SessionNameEntitySchema = z.string().max(255)

export const AgentSessionEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string().nullable(),
  /** May be empty for an untitled placeholder session, matching topic.name semantics. */
  name: SessionNameEntitySchema,
  isNameManuallyEdited: z.boolean(),
  description: z.string().optional(),
  workspaceId: z.string(),
  workspace: AgentWorkspaceEntitySchema,
  /** Container-level OTel trace id — one trace tree per session. */
  traceId: TraceIdSchema.optional(),
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Soft-delete timestamp (ISO string). Present only on trashed rows
   * (`inTrash: true` listings). Read-only — never in mutable DTOs; restoring
   * goes through `POST /agent-sessions/:sessionId/restore`, not a writable
   * `deletedAt`.
   */
  deletedAt: z.string().optional()
})
export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

// Create requires a real `agentId` — orphans only happen via cascade, never on insert.
export const CreateAgentSessionSchema = z.strictObject({
  agentId: z.string().min(1),
  name: SessionNameEntitySchema,
  description: z.string().optional(),
  workspace: AgentSessionWorkspaceSourceSchema
})
export type CreateAgentSessionDto = z.infer<typeof CreateAgentSessionSchema>

export const UpdateAgentSessionSchema = z.strictObject({
  name: SessionNameEntitySchema.optional(),
  isNameManuallyEdited: z.boolean().optional(),
  description: z.string().optional(),
  agentId: z.string().min(1).optional()
})

export type UpdateAgentSessionDto = z.infer<typeof UpdateAgentSessionSchema>

/**
 * Body for `PUT /agent-sessions/:sessionId/workspace`. Replacing a session's
 * workspace creates/deletes the backing system workspace row and is only
 * allowed before any message exists, so it lives on a dedicated sub-resource
 * rather than the generic PATCH (see api-design-guidelines: complex
 * side-effects / resource creation → dedicated endpoint).
 */
export const SetAgentSessionWorkspaceSchema = AgentSessionWorkspaceSourceSchema
export type SetAgentSessionWorkspaceDto = AgentSessionWorkspaceSource

/** Query for `GET /agent-sessions` (cursor pagination + optional agent filter). */
export const ListAgentSessionsQuerySchema = z.strictObject({
  agentId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  /** `true` lists only trashed (soft-deleted) sessions; omitted/false lists active only. */
  inTrash: z.boolean().optional()
})
export type ListAgentSessionsQueryParams = z.input<typeof ListAgentSessionsQuerySchema>
export type ListAgentSessionsQuery = z.output<typeof ListAgentSessionsQuerySchema>

export interface DeleteAgentSessionsResult {
  deletedIds: string[]
}

export interface RestoreAgentSessionsResult {
  restoredIds: string[]
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
  ids: DeleteAgentSessionsIdsQueryValueSchema,
  /**
   * `true` skips the trash: session rows are hard-deleted (session messages
   * FK-cascade, backing system workspace rows are removed, pins purged).
   * Omitted/false archives (soft-deletes) so the sessions are restorable.
   */
  permanent: z.boolean().optional()
})
export type DeleteAgentSessionsQueryParams = z.input<typeof DeleteAgentSessionsQuerySchema>

/** Query for `DELETE /agent-sessions/:sessionId`. */
export const DeleteAgentSessionQuerySchema = z.strictObject({
  /** Same semantics as the bulk `permanent` flag, scoped to one session. */
  permanent: z.boolean().optional()
})
export type DeleteAgentSessionQueryParams = z.input<typeof DeleteAgentSessionQuerySchema>

/** Query for `POST /agent-sessions/restore` (CSV ids, same cap as bulk delete). */
export const RestoreAgentSessionsQuerySchema = z.strictObject({
  ids: DeleteAgentSessionsIdsQueryValueSchema
})
export type RestoreAgentSessionsQueryParams = z.input<typeof RestoreAgentSessionsQuerySchema>

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
     * actually affected.
     *
     * Default archives (soft-deletes; pins purged, session messages and backing
     * workspace rows untouched). `permanent=true` hard-deletes: session messages
     * FK-cascade and backing system workspace rows are removed too.
     */
    DELETE: {
      query: DeleteAgentSessionsQueryParams
      response: DeleteAgentSessionsResult
    }
  }

  /**
   * Bulk-restore trashed sessions (resource-action pattern, CSV ids).
   * Missing/active ids are ignored; `restoredIds` reports what was restored.
   * Pins purged at archive time are NOT restored.
   * @example POST /agent-sessions/restore?ids=a,b
   */
  '/agent-sessions/restore': {
    POST: {
      query: RestoreAgentSessionsQueryParams
      response: RestoreAgentSessionsResult
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
     * Default archives (soft-deletes; pins purged, session messages and backing
     * workspace row untouched). `permanent=true` hard-deletes: session messages
     * FK-cascade and a backing system workspace row is removed too.
     */
    DELETE: {
      params: { sessionId: string }
      query?: DeleteAgentSessionQueryParams
      response: void
    }
  }

  /**
   * Restore one trashed session (resource-action pattern).
   * Clears `deletedAt` so the session reappears in active listings.
   * Pins purged at archive time are NOT restored.
   * @example POST /agent-sessions/abc123/restore
   */
  '/agent-sessions/:sessionId/restore': {
    POST: {
      params: { sessionId: string }
      response: AgentSessionEntity
    }
  }

  '/agent-sessions/:sessionId/workspace': {
    /**
     * Replace the session's workspace. Only permitted while the session has no
     * messages — once a conversation has started the binding is permanent
     * (NOT_FOUND if the session is missing, INVALID_OPERATION if it already has
     * messages).
     *
     * Side effects: switching away from a system workspace deletes that backing
     * row; switching to `{ type: 'system' }` creates a fresh system workspace.
     */
    PUT: {
      params: { sessionId: string }
      body: SetAgentSessionWorkspaceDto
      response: AgentSessionEntity
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
     * Archive every active session belonging to an agent (all-or-nothing —
     * missing agent → NOT_FOUND). Session pins are purged; session messages
     * and backing workspace rows are untouched so restore is lossless.
     */
    DELETE: {
      params: { agentId: string }
      response: DeleteAgentSessionsResult
    }
  }
} & OrderEndpoints<'/agent-sessions'>
