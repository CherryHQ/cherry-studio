/**
 * Agents domain API Schema definitions
 *
 * Covers agents, sessions, session messages, scheduled tasks, and skills.
 * Entity schemas and types live in `@shared/data/types/agent`.
 *
 * DTOs are hand-written Zod schemas (Rule C exception #3: DTO fields are
 * camelCase while entity fields are still snake_case). Once entity types
 * migrate to camelCase (C2), DTOs should be derived via `.pick()`.
 */

import type {
  AgentDetail,
  AgentSessionDetail,
  AgentSessionEntity,
  AgentSessionMessageEntity,
  InstalledSkill,
  ScheduledTaskEntity
} from '@shared/data/types/agent'
import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// Shared field atoms
// ============================================================================

const SlashCommandSchema = z.object({
  command: z.string(),
  description: z.string().optional()
})

const AgentConfigurationSchema = z.record(z.string(), z.unknown())

// ============================================================================
// Agent DTOs
// ============================================================================

export const CreateAgentSchema = z.object({
  type: z.enum(['claude-code']),
  name: z.string().min(1),
  model: z.string().min(1),
  description: z.string().optional(),
  accessiblePaths: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  planModel: z.string().optional(),
  smallModel: z.string().optional(),
  mcps: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  slashCommands: z.array(SlashCommandSchema).optional(),
  configuration: AgentConfigurationSchema.optional()
})
export type CreateAgentDto = z.infer<typeof CreateAgentSchema>

export const UpdateAgentSchema = CreateAgentSchema.omit({ type: true }).partial()
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>

// ============================================================================
// Session DTOs
// ============================================================================

export const CreateSessionSchema = z.object({
  model: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  accessiblePaths: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  planModel: z.string().optional(),
  smallModel: z.string().optional(),
  mcps: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  slashCommands: z.array(SlashCommandSchema).optional(),
  configuration: AgentConfigurationSchema.optional()
})
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>

export const UpdateSessionSchema = CreateSessionSchema.partial()
export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>

// ============================================================================
// Task DTOs
// ============================================================================

export const CreateTaskSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  scheduleType: z.enum(['cron', 'interval', 'once']),
  scheduleValue: z.string().min(1),
  timeoutMinutes: z.number().min(1).nullable().optional(),
  channelIds: z.array(z.string()).optional()
})
export type CreateTaskDto = z.infer<typeof CreateTaskSchema>

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  status: z.enum(['active', 'paused', 'completed']).optional()
})
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>

// ============================================================================
// Common query types
// ============================================================================

export const ListQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(500).optional()
})
export type ListQuery = z.infer<typeof ListQuerySchema>

export const ListSessionMessagesQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(500).optional()
})
export type ListSessionMessagesQuery = z.infer<typeof ListSessionMessagesQuerySchema>

// ============================================================================
// API Schema definitions
// ============================================================================

export type AgentSchemas = {
  /** List all agents, create a new agent */
  '/agents': {
    GET: {
      query?: ListQuery
      response: OffsetPaginationResponse<AgentDetail>
    }
    POST: {
      body: CreateAgentDto
      response: AgentDetail
    }
  }

  /** Get, update, or delete a specific agent */
  '/agents/:agentId': {
    GET: {
      params: { agentId: string }
      response: AgentDetail
    }
    PATCH: {
      params: { agentId: string }
      body: UpdateAgentDto
      response: AgentDetail
    }
    DELETE: {
      params: { agentId: string }
      response: void
    }
  }

  /** List sessions for an agent, create a new session */
  '/agents/:agentId/sessions': {
    GET: {
      params: { agentId: string }
      query?: ListQuery
      response: OffsetPaginationResponse<AgentSessionEntity>
    }
    POST: {
      params: { agentId: string }
      body: CreateSessionDto
      response: AgentSessionDetail
    }
  }

  /** Get, update, or delete a specific session */
  '/agents/:agentId/sessions/:sessionId': {
    GET: {
      params: { agentId: string; sessionId: string }
      response: AgentSessionDetail
    }
    PATCH: {
      params: { agentId: string; sessionId: string }
      body: UpdateSessionDto
      response: AgentSessionEntity
    }
    DELETE: {
      params: { agentId: string; sessionId: string }
      response: void
    }
  }

  /** List session messages */
  '/agents/:agentId/sessions/:sessionId/messages': {
    GET: {
      params: { agentId: string; sessionId: string }
      query?: ListSessionMessagesQuery
      response: { messages: AgentSessionMessageEntity[] }
    }
  }

  /** Delete a specific session message */
  '/agents/:agentId/sessions/:sessionId/messages/:messageId': {
    DELETE: {
      params: { agentId: string; sessionId: string; messageId: string }
      response: void
    }
  }

  /** List tasks for an agent, create a new task */
  '/agents/:agentId/tasks': {
    GET: {
      params: { agentId: string }
      query?: ListQuery
      response: OffsetPaginationResponse<ScheduledTaskEntity>
    }
    POST: {
      params: { agentId: string }
      body: CreateTaskDto
      response: ScheduledTaskEntity
    }
  }

  /** Get, update, or delete a specific task */
  '/agents/:agentId/tasks/:taskId': {
    GET: {
      params: { agentId: string; taskId: string }
      response: ScheduledTaskEntity
    }
    PATCH: {
      params: { agentId: string; taskId: string }
      body: UpdateTaskDto
      response: ScheduledTaskEntity
    }
    DELETE: {
      params: { agentId: string; taskId: string }
      response: void
    }
  }

  /** List all installed skills (optionally filtered by agent) */
  '/skills': {
    GET: {
      query: { agentId?: string }
      response: { data: InstalledSkill[] }
    }
  }

  /** Get a specific skill by ID */
  '/skills/:skillId': {
    GET: {
      params: { skillId: string }
      response: InstalledSkill
    }
  }
}
