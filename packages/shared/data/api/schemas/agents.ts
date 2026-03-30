/**
 * Agent API Schema definitions
 *
 * Contains endpoints for Agent and AgentSession CRUD operations.
 * Entity schemas and types live in `@shared/data/types/agent`.
 */

import * as z from 'zod'

import { type Agent, AgentSchema, type AgentSession, AgentSessionSchema } from '../../types/agent'
import type { Message } from '../../types/message'
import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// DTO Derivation
// ============================================================================

/** Fields auto-managed by the database layer, excluded from DTOs */
const AutoFields = { id: true, createdAt: true, updatedAt: true } as const

/**
 * DTO for creating a new agent.
 * - `type`, `name`, `model` are required
 * - `id` is excluded (auto-generated UUID by database)
 */
export const CreateAgentSchema = AgentSchema.omit(AutoFields).partial().required({
  type: true,
  name: true,
  model: true
})
export type CreateAgentDto = z.infer<typeof CreateAgentSchema>

/**
 * DTO for updating an existing agent.
 * All fields optional, `id` excluded (comes from URL path).
 */
export const UpdateAgentSchema = AgentSchema.omit(AutoFields).partial()
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>

/**
 * DTO for creating a new agent session.
 * - `model` is required (snapshot from agent at creation)
 * - `agentId`, `agentType`, `topicId` are set by the server
 */
export const CreateAgentSessionSchema = AgentSessionSchema.omit({
  ...AutoFields,
  agentId: true,
  agentType: true,
  topicId: true,
  sdkSessionId: true
})
  .partial()
  .required({ model: true })
export type CreateAgentSessionDto = z.infer<typeof CreateAgentSessionSchema>

/**
 * Body for reordering agents or sessions
 */
export const ReorderAgentsSchema = z.object({
  orderedIds: z.array(z.string().min(1))
})
export type ReorderAgentsBody = z.infer<typeof ReorderAgentsSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface AgentSchemas {
  '/agents': {
    /** List all agents */
    GET: {
      query?: { page?: number; limit?: number; type?: string }
      response: OffsetPaginationResponse<Agent>
    }
    /** Create a new agent */
    POST: {
      body: CreateAgentDto
      response: Agent
    }
    /** Reorder agents */
    PATCH: {
      body: ReorderAgentsBody
      response: void
    }
  }

  '/agents/:id': {
    /** Get an agent by ID */
    GET: {
      params: { id: string }
      response: Agent
    }
    /** Update an agent */
    PATCH: {
      params: { id: string }
      body: UpdateAgentDto
      response: Agent
    }
    /** Delete an agent (soft delete) */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/agents/:agentId/sessions': {
    /** List sessions for an agent */
    GET: {
      params: { agentId: string }
      query?: { page?: number; limit?: number }
      response: OffsetPaginationResponse<AgentSession>
    }
    /** Create a new session (auto-creates topic, snapshots agent config) */
    POST: {
      params: { agentId: string }
      body: CreateAgentSessionDto
      response: AgentSession
    }
    /** Reorder sessions */
    PATCH: {
      params: { agentId: string }
      body: ReorderAgentsBody
      response: void
    }
  }

  '/agents/:agentId/sessions/:id': {
    /** Get a session by ID */
    GET: {
      params: { agentId: string; id: string }
      response: AgentSession
    }
    /** Delete a session (cascades to topic and messages) */
    DELETE: {
      params: { agentId: string; id: string }
      response: void
    }
  }

  '/agents/:agentId/sessions/:sessionId/messages': {
    /** Get all messages for a session (via topic) */
    GET: {
      params: { agentId: string; sessionId: string }
      response: Message[]
    }
  }
}
