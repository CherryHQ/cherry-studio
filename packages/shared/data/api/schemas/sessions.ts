/**
 * Session domain API Schema definitions.
 *
 * A `Session` is one execution of an `Agent` bound to a workspace
 * (`accessiblePaths`, the CMA-Environment equivalent). All cognitive config
 * (model, instructions, mcps, allowedTools, configuration, ...) lives on the
 * parent agent and is fetched separately via `useAgent(session.agentId)`
 * (renderer) or `agentService.getAgent(...)` (main); workspace lives on the
 * session itself and is **insert-only** — `UpdateSessionDto` deliberately does
 * not include it, so a running session can't be re-pointed at a new directory.
 */

import * as z from 'zod'

import type { CursorPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'
import type { AgentSessionMessageEntitySchema } from './agents'
import { AgentNameAtomSchema } from './agents'

/** Cursor-paginated query for `/sessions/:sessionId/messages`. Walks history
 *  newest-first; an absent `cursor` returns the most recent page, then each
 *  `nextCursor` walks one page older. Limit caps at 200 — the renderer
 *  flattens with `useInfiniteFlatItems` and the virtualizer scrolls older
 *  pages in on demand, so per-page size never has to cover a whole session. */
export const SESSION_MESSAGES_MAX_LIMIT = 200
export const SESSION_MESSAGES_DEFAULT_LIMIT = 50

export const SessionMessagesListQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(SESSION_MESSAGES_MAX_LIMIT).optional()
})
export type SessionMessagesListQuery = z.infer<typeof SessionMessagesListQuerySchema>

// ============================================================================
// Entity & DTOs (Rule C: derive DTOs via .pick())
// ============================================================================

export const AgentSessionEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string().nullable(),
  name: AgentNameAtomSchema,
  description: z.string().optional(),
  // Workspace bound at session create time. Read-only post-creation —
  // `UpdateSessionSchema` (below) intentionally doesn't pick this.
  accessiblePaths: z.array(z.string()),
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

// Create requires a real `agentId` — orphans only happen via cascade, never on insert.
// `accessiblePaths` is optional at create time — when omitted, the service
// inherits from the latest sibling session of the same agent.
export const CreateSessionSchema = z.strictObject({
  agentId: z.string().min(1),
  name: AgentNameAtomSchema,
  description: z.string().optional(),
  accessiblePaths: z.array(z.string()).optional()
})
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>

export const UpdateSessionSchema = z.strictObject({
  name: AgentNameAtomSchema.optional(),
  description: z.string().optional(),
  agentId: z.string().min(1).optional()
})

export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>

/** Query for `GET /sessions` (cursor pagination + optional agent filter). */
export const ListSessionsQuerySchema = z.strictObject({
  agentId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
})
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>

// ============================================================================
// API Schema definitions
// ============================================================================

export type SessionSchemas = {
  '/sessions': {
    GET: {
      query?: ListSessionsQuery
      response: CursorPaginationResponse<AgentSessionEntity>
    }
    POST: {
      body: CreateSessionDto
      response: AgentSessionEntity
    }
  }

  '/sessions/:sessionId': {
    GET: {
      params: { sessionId: string }
      response: AgentSessionEntity
    }
    PATCH: {
      params: { sessionId: string }
      body: UpdateSessionDto
      response: AgentSessionEntity
    }
    DELETE: {
      params: { sessionId: string }
      response: void
    }
  }

  '/sessions/:sessionId/messages': {
    GET: {
      params: { sessionId: string }
      query?: SessionMessagesListQuery
      response: CursorPaginationResponse<z.infer<typeof AgentSessionMessageEntitySchema>>
    }
  }

  '/sessions/:sessionId/messages/:messageId': {
    DELETE: {
      params: { sessionId: string; messageId: string }
      response: void
    }
  }
} & OrderEndpoints<'/sessions'>
