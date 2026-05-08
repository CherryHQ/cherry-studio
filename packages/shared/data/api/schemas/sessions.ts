/**
 * Session domain API Schema definitions.
 *
 * A `Session` is a pure instance of an `Agent` — its only persisted state is
 * (id, agentId, name, description, orderKey, timestamps). Config (model,
 * instructions, mcps, allowedTools, accessiblePaths, configuration, ...) lives
 * on the parent agent and is fetched separately via `useAgent(session.agentId)`
 * (renderer) or `agentService.getAgent(...)` (main).
 */

import * as z from 'zod'

import type { CursorPaginationResponse, OffsetPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'
import type { AgentSessionMessageEntitySchema } from './agents'
import { AgentNameAtomSchema, type ListQuery } from './agents'

// ============================================================================
// Entity & DTOs (Rule C: derive DTOs via .pick())
// ============================================================================

export const AgentSessionEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string().nullable(),
  name: AgentNameAtomSchema,
  description: z.string().optional(),
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

// Create requires a real `agentId` — orphans only happen via cascade, never on insert.
export const CreateSessionSchema = z.strictObject({
  agentId: z.string(),
  name: AgentNameAtomSchema,
  description: z.string().optional()
})
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>

export const UpdateSessionSchema = AgentSessionEntitySchema.pick({
  name: true,
  description: true
}).partial()
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
      query?: ListQuery
      response: OffsetPaginationResponse<z.infer<typeof AgentSessionMessageEntitySchema>>
    }
  }

  '/sessions/:sessionId/messages/:messageId': {
    DELETE: {
      params: { sessionId: string; messageId: string }
      response: void
    }
  }
} & OrderEndpoints<'/sessions'>
