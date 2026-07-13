/**
 * Agent session domain API Schema definitions.
 */

import {
  ContentMessageRoleSchema,
  MessageDataSchema,
  MessageSnapshotSchema,
  MessageStatsSchema,
  MessageStatusSchema
} from '@shared/data/types/message'
import { TraceIdSchema } from '@shared/data/types/trace'
import * as z from 'zod'

import type { CursorPaginationResponse } from '../types'
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
  updatedAt: z.string()
})
export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

/** Fixed collection projection; by-id and mutation responses remain pure session entities. */
export type AgentSessionListItem = AgentSessionEntity & { pinned: boolean; pinId: string | null }

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

/**
 * Owner scope for session list/stats filters: a concrete agent id, or the
 * literal `'unlinked'` for sessions whose agent was deleted via cascade
 * (`agentId IS NULL`). Agent ids are UUIDs, so the sentinel cannot collide.
 */
export const AgentSessionOwnerScopeSchema = z.union([z.uuidv4(), z.literal('unlinked')])
export type AgentSessionOwnerScope = z.infer<typeof AgentSessionOwnerScopeSchema>

/** A concrete user-workspace id, or the aggregate `system` scope sentinel. */
export const AgentSessionWorkspaceScopeSchema = z.string().min(1)
export type AgentSessionWorkspaceScope = z.infer<typeof AgentSessionWorkspaceScopeSchema>

/**
 * Sort profiles for `GET /agent-sessions` (D1 of #16890). Direction is derived
 * server-side: `createdAt` → creation order (`createdAt DESC, id ASC`),
 * `updatedAt` → activity (`updatedAt DESC, id ASC`), `orderKey` → manual drag
 * order (`orderKey ASC, id ASC`). A pinned-only query uses the independent
 * `pin.orderKey ASC, id ASC` order instead.
 */
export const AgentSessionSortBySchema = z.enum(['createdAt', 'updatedAt', 'orderKey'])
export type AgentSessionSortBy = z.infer<typeof AgentSessionSortBySchema>

/**
 * Search scope (D6 of #16890): `name` is a literal substring over the session
 * name (resource-list behavior); `full` additionally ORs the session
 * description and the owning agent's name (Agent History behavior).
 */
export const AgentSessionSearchScopeSchema = z.enum(['name', 'full'])
export type AgentSessionSearchScope = z.infer<typeof AgentSessionSearchScopeSchema>

const hasSessionRecordFilters = (q: {
  q?: string
  searchScope?: string
  pinned?: boolean
  ids?: string[]
  agentId?: string
  workspaceId?: string
}) =>
  q.q !== undefined ||
  q.searchScope !== undefined ||
  q.pinned !== undefined ||
  q.ids !== undefined ||
  q.agentId === 'unlinked' ||
  q.workspaceId !== undefined

/**
 * Query for `GET /agent-sessions`.
 *
 * `pinned=true` selects a pin-owned stream ordered by `pin.orderKey ASC`; its
 * order is independent of the session sort profile. Otherwise, without
 * `sortBy` the response is the legacy composite view (pinned first by
 * `pin.orderKey`, then unpinned by `session.orderKey ASC`) and only a concrete
 * `agentId` filter is accepted. With `sortBy` the response is a single flat
 * stream with a `(sortValue, id)` keyset cursor, and the record filters below
 * apply. Workspace grouping uses the stable workspace id; path remains
 * presentation metadata.
 */
export const ListAgentSessionsQuerySchema = z
  .strictObject({
    /** Owner scope: concrete agent id, or 'unlinked' (`agentId IS NULL`, flat path only). */
    agentId: AgentSessionOwnerScopeSchema.optional(),
    /** Opaque cursor from previous page's `nextCursor`. Valid only with the same filter+sort query. */
    cursor: z.string().optional(),
    /** Page size; defaults to 50 in the service. */
    limit: z.coerce.number().int().positive().max(200).optional(),
    /** Sort profile; omitted with pinned=true → pin order, otherwise the legacy composite view. */
    sortBy: AgentSessionSortBySchema.optional(),
    /** Literal substring search term (escaped LIKE; `%`/`_`/`\` are not wildcards). */
    q: z.string().optional(),
    /** Search scope for `q`; defaults to `name` in the service. */
    searchScope: AgentSessionSearchScopeSchema.optional(),
    /** true → pin-owned stream; false → only unpinned sessions (requires sortBy). Omitted → both. */
    pinned: z.boolean().optional(),
    /** Bounded explicit id filter (e.g. History running/failed row fetches). */
    ids: z.array(z.string().min(1)).min(1).max(200).optional(),
    /** Concrete user workspace id, or 'system' for generated/no-workdir sessions. */
    workspaceId: AgentSessionWorkspaceScopeSchema.optional()
  })
  .refine((q) => q.sortBy !== undefined || q.pinned === true || !hasSessionRecordFilters(q), {
    message: 'record filters (q/searchScope/pinned/ids/owner/workspace scope) require sortBy unless pinned=true'
  })
export type ListAgentSessionsQueryParams = z.input<typeof ListAgentSessionsQuerySchema>
export type ListAgentSessionsQuery = z.output<typeof ListAgentSessionsQuerySchema>

/**
 * Query for `GET /agent-sessions/stats`. Current consumers need owner scope
 * and name search only; pagination, pin state, ids, workspace filtering and
 * full-text scope remain list-only concerns.
 */
export const AgentSessionStatsQuerySchema = z.strictObject({
  q: z.string().optional(),
  agentId: AgentSessionOwnerScopeSchema.optional()
})
export type AgentSessionStatsQuery = z.infer<typeof AgentSessionStatsQuerySchema>

/**
 * Response for `GET /agent-sessions/stats`. Factual aggregation only — the
 * renderer derives display counts (`count - pinnedCount`). `byAgent` is an
 * array so the unlinked scope (`agentId: null`) is representable. Workspace
 * facts use a stable user-workspace id or the aggregate `system` sentinel.
 * Stats and list calls are separate
 * SQLite snapshots; invalidation reconciles transient disagreement.
 */
export interface AgentSessionStats {
  total: number
  pinnedCount: number
  byAgent: Array<{ agentId: string | null; count: number; pinnedCount: number }>
  byWorkspace: Array<{ workspaceId: AgentSessionWorkspaceScope; count: number; pinnedCount: number }>
}

export interface DeleteAgentSessionsResult {
  deletedIds: string[]
}

/** Response for `GET /agent-sessions/latest` — the most-recently-updated session, or `null` when there are none. */
export interface LatestAgentSessionResponse {
  session: AgentSessionEntity | null
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
      response: CursorPaginationResponse<AgentSessionListItem>
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

  /**
   * Most-recently-updated session across all agents.
   *
   * First-entry restore reads this to resume the last-touched session. Declared
   * before `/agent-sessions/:sessionId` and matched exactly by the server router,
   * so `latest` is never mistaken for a session id. Proves global latest via
   * `updatedAt DESC LIMIT 1`, unlike the `orderKey`-paged `/agent-sessions` first
   * page.
   */
  '/agent-sessions/latest': {
    GET: {
      response: LatestAgentSessionResponse
    }
  }

  /**
   * Factual aggregation over sessions (D3 of #16890): totals, pinned counts,
   * per-agent and per-workspace breakdowns under the same record filters as the
   * list. Declared before `/agent-sessions/:sessionId` and matched exactly by
   * the server router, so `stats` is never mistaken for a session id.
   */
  '/agent-sessions/stats': {
    GET: {
      query?: AgentSessionStatsQuery
      response: AgentSessionStats
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
