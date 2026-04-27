/**
 * Agents domain API Schema definitions
 *
 * Covers agents, sessions, session messages, scheduled tasks, and skills.
 * Entity schemas live here (Rule C/D: entity role wins when a type is both
 * a response payload and an entity). DTOs are derived via .pick().
 */

import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// Field atoms (shared validators reused across entity and DTO schemas)
// ============================================================================

export const AgentNameAtomSchema = z.string().min(1)
export const ModelIdAtomSchema = z.string().min(1)
export const ScheduleTypeAtomSchema = z.enum(['cron', 'interval', 'once'])
export const ScheduleValueAtomSchema = z.string().min(1)
export const TimeoutMinutesAtomSchema = z.number().min(1).nullable().optional()

export const SlashCommandSchema = z.strictObject({
  command: z.string(),
  description: z.string().optional()
})
export type SlashCommand = z.infer<typeof SlashCommandSchema>

export const AgentToolSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().optional()
})
export type AgentTool = z.infer<typeof AgentToolSchema>

export const AgentConfigurationSchema = z.record(z.string(), z.unknown())
export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>

// ============================================================================
// Agent entity schemas (Rule C: entity schemas live in packages/shared/data/api/schemas/)
// ============================================================================

/** Core mutable fields shared between agent and session rows. */
export const AgentBaseSchema = z.strictObject({
  name: AgentNameAtomSchema,
  description: z.string().optional(),
  accessiblePaths: z.array(z.string()),
  instructions: z.string().optional(),
  model: ModelIdAtomSchema,
  planModel: z.string().optional(),
  smallModel: z.string().optional(),
  mcps: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  configuration: AgentConfigurationSchema.optional()
})
export type AgentBase = z.infer<typeof AgentBaseSchema>

/** Pick-set for agent mutable fields — used for DTO derivation and service update logic. */
export const AGENT_MUTABLE_FIELDS = {
  name: true,
  description: true,
  accessiblePaths: true,
  instructions: true,
  model: true,
  planModel: true,
  smallModel: true,
  mcps: true,
  allowedTools: true,
  configuration: true
} as const

/** Pick-set for session mutable fields — superset of AGENT_MUTABLE_FIELDS. */
export const SESSION_MUTABLE_FIELDS = {
  ...AGENT_MUTABLE_FIELDS,
  slashCommands: true
} as const

export const AgentEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  type: z.enum(['claude-code']),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentEntity = z.infer<typeof AgentEntitySchema>

export const AgentDetailSchema = AgentEntitySchema.extend({
  tools: z.array(AgentToolSchema).optional()
})
export type AgentDetail = z.infer<typeof AgentDetailSchema>

export const AgentSessionEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  agentId: z.string(),
  agentType: z.enum(['claude-code']),
  slashCommands: z.array(SlashCommandSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

export const AgentSessionDetailSchema = AgentSessionEntitySchema.extend({
  tools: z.array(AgentToolSchema).optional(),
  messages: z.array(z.unknown()).optional(),
  plugins: z
    .array(
      z.strictObject({
        filename: z.string(),
        type: z.enum(['agent', 'command', 'skill']),
        metadata: z.record(z.string(), z.unknown())
      })
    )
    .optional()
})
export type AgentSessionDetail = z.infer<typeof AgentSessionDetailSchema>

export const AgentSessionMessageEntitySchema = z.strictObject({
  id: z.number(),
  sessionId: z.string(),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.unknown(),
  agentSessionId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentSessionMessageEntity = z.infer<typeof AgentSessionMessageEntitySchema>

export const ScheduledTaskEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string(),
  name: z.string(),
  prompt: z.string(),
  scheduleType: ScheduleTypeAtomSchema,
  scheduleValue: z.string(),
  timeoutMinutes: z.number(),
  channelIds: z.array(z.string()).optional(),
  nextRun: z.string().nullable().optional(),
  lastRun: z.string().nullable().optional(),
  lastResult: z.string().nullable().optional(),
  status: z.enum(['active', 'paused', 'completed']),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ScheduledTaskEntity = z.infer<typeof ScheduledTaskEntitySchema>

/** Reserved for a future task-run-log endpoint; not yet exposed in AgentSchemas. */
export const TaskRunLogEntitySchema = z.strictObject({
  id: z.number(),
  taskId: z.string(),
  sessionId: z.string().nullable().optional(),
  runAt: z.string(),
  durationMs: z.number(),
  status: z.enum(['running', 'success', 'error']),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional()
})
export type TaskRunLogEntity = z.infer<typeof TaskRunLogEntitySchema>

export const InstalledSkillSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderName: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  namespace: z.string().nullable(),
  author: z.string().nullable(),
  tags: z.array(z.string()),
  contentHash: z.string(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type InstalledSkill = z.infer<typeof InstalledSkillSchema>

// ============================================================================
// Agent DTOs (derived via .pick() from AgentEntitySchema — Rule C)
// ============================================================================

export const CreateAgentSchema = AgentEntitySchema.pick({ type: true, ...AGENT_MUTABLE_FIELDS }).extend({
  accessiblePaths: z.array(z.string()).default([])
})
export type CreateAgentDto = z.infer<typeof CreateAgentSchema>

// Update picks directly from the entity (not from Create) to avoid .default([]) bleeding into partial updates.
export const UpdateAgentSchema = AgentEntitySchema.pick(AGENT_MUTABLE_FIELDS).partial()
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>

// ============================================================================
// Session DTOs (derived via .pick() from AgentSessionEntitySchema — Rule C)
// ============================================================================

export const CreateSessionSchema = AgentSessionEntitySchema.pick(SESSION_MUTABLE_FIELDS).partial()
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>

export const UpdateSessionSchema = CreateSessionSchema
export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>

// ============================================================================
// Task DTOs
// ============================================================================

export const CreateTaskSchema = z.strictObject({
  name: z.string().min(1),
  prompt: z.string().min(1),
  scheduleType: ScheduleTypeAtomSchema,
  scheduleValue: ScheduleValueAtomSchema,
  timeoutMinutes: TimeoutMinutesAtomSchema,
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

export const ListQuerySchema = z.strictObject({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(500).optional()
})
export type ListQuery = z.infer<typeof ListQuerySchema>

// ============================================================================
// API Schema definitions
// ============================================================================

export type AgentSchemas = {
  /** List all agents, create a new agent */
  '/agents': {
    GET: {
      query?: ListQuery
      response: OffsetPaginationResponse<AgentEntity>
    }
    POST: {
      body: CreateAgentDto
      response: AgentEntity
    }
  }

  /** Get, update, or delete a specific agent */
  '/agents/:agentId': {
    GET: {
      params: { agentId: string }
      response: AgentEntity
    }
    PATCH: {
      params: { agentId: string }
      body: UpdateAgentDto
      response: AgentEntity
    }
    DELETE: {
      params: { agentId: string }
      response: void
    }
  }

  /** Duplicate a specific agent */
  '/agents/:agentId/duplicate': {
    POST: {
      params: { agentId: string }
      response: AgentEntity
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
      response: AgentSessionEntity
    }
  }

  /** Get, update, or delete a specific session */
  '/agents/:agentId/sessions/:sessionId': {
    GET: {
      params: { agentId: string; sessionId: string }
      response: AgentSessionEntity
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

  /** List session messages (paginated) */
  '/agents/:agentId/sessions/:sessionId/messages': {
    GET: {
      params: { agentId: string; sessionId: string }
      query?: ListQuery
      response: OffsetPaginationResponse<AgentSessionMessageEntity>
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
      response: InstalledSkill[]
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
