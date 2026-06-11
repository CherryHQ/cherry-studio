/**
 * Agents domain API Schema definitions
 *
 * Covers agents and scheduled tasks.
 * Entity schemas live here (Rule C/D: entity role wins when a type is both
 * a response payload and an entity). DTOs are derived via .pick().
 */

import { UniqueModelIdSchema } from '@shared/data/types/model'
import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'
import { AgentSessionWorkspaceSourceSchema } from './agentWorkspaces'
import { JobScheduleNameAtomSchema, TriggerSchema } from './jobs'

// ============================================================================
// Field atoms (shared validators reused across entity and DTO schemas)
// ============================================================================

export const AgentNameAtomSchema = z.string().min(1)
export const ModelIdAtomSchema = z.string().min(1)
export const TimeoutMinutesAtomSchema = z.number().min(1).nullable().optional()

export const AgentPermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
export type AgentPermissionMode = z.infer<typeof AgentPermissionModeSchema>
export const AgentSchedulerTypeSchema = z.enum(['cron', 'interval', 'one-time'])

export const AgentConfigurationSchema = z
  .object({
    avatar: z.string().optional(),
    slash_commands: z.array(z.string()).optional(),
    permission_mode: AgentPermissionModeSchema.optional(),
    max_turns: z.number().optional(),
    env_vars: z.record(z.string(), z.string()).optional(),
    soul_enabled: z.boolean().optional(),
    bootstrap_completed: z.boolean().optional(),
    scheduler_enabled: z.boolean().optional(),
    scheduler_type: AgentSchedulerTypeSchema.optional(),
    scheduler_cron: z.string().optional(),
    scheduler_interval: z.number().optional(),
    scheduler_one_time_delay: z.number().optional(),
    scheduler_last_run: z.string().optional(),
    heartbeat_enabled: z.boolean().optional(),
    heartbeat_interval: z.number().optional()
  })
  // .loose() (passthrough) is intentional: the configuration object is stored as a JSON blob
  // and may contain keys written by older or newer versions of the app. Unknown fields must
  // survive a round-trip through parse() so they are not silently dropped on the next save.
  .loose()
export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>

/**
 * Read-side sanitizer for stored configuration JSON.
 *
 * `safeParse` failure on `.loose()` schemas means a *known* key has the wrong
 * type — not unknown extras. Returning the raw blob as-is would launder a
 * type mismatch (e.g. `max_turns: "5"`) into the response, defeating downstream
 * `?? DEFAULT` fallbacks. Instead, drop only the offending top-level keys so
 * those branches can fire normally; well-typed fields and unknown extras are
 * preserved.
 */
export function sanitizeAgentConfiguration(raw: unknown): {
  data: AgentConfiguration | undefined
  invalidKeys: string[]
} {
  if (raw == null) return { data: undefined, invalidKeys: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { data: undefined, invalidKeys: ['<root>'] }
  }
  const parsed = AgentConfigurationSchema.safeParse(raw)
  if (parsed.success) return { data: parsed.data, invalidKeys: [] }

  const invalidKeys = Array.from(
    new Set(parsed.error.issues.map((i) => i.path[0]).filter((p): p is string => typeof p === 'string'))
  )
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!invalidKeys.includes(key)) filtered[key] = value
  }
  const reparsed = AgentConfigurationSchema.safeParse(filtered)
  return {
    data: reparsed.success ? reparsed.data : ({} as AgentConfiguration),
    invalidKeys
  }
}

// ============================================================================
// Agent entity schemas (Rule C: entity schemas live in src/shared/data/api/schemas/)
// ============================================================================

/** Core mutable fields shared between agent and session rows. */
export const AgentBaseSchema = z.strictObject({
  name: AgentNameAtomSchema,
  description: z.string().optional(),
  instructions: z.string().optional(),
  model: UniqueModelIdSchema,
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
  instructions: true,
  model: true,
  planModel: true,
  smallModel: true,
  mcps: true,
  allowedTools: true,
  configuration: true
} as const

export const AgentEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  type: z.enum(['claude-code']),
  createdAt: z.string(),
  updatedAt: z.string(),
  model: UniqueModelIdSchema.nullable(),
  /**
   * Human-readable primary model name resolved from `user_model.name` at read
   * time. Edits still go through the `model` UniqueModelId field.
   */
  modelName: z.string().nullable()
})

export type AgentEntity = z.infer<typeof AgentEntitySchema>

export const ScheduledTaskEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string(),
  name: z.string(),
  prompt: z.string(),
  /** Discriminated union — see TriggerSchema for {cron|interval|once} shape. */
  trigger: TriggerSchema,
  timeoutMinutes: z.number(),
  workspace: AgentSessionWorkspaceSourceSchema,
  channelIds: z.array(z.string()).optional(),
  nextRun: z.string().nullable().optional(),
  lastRun: z.string().nullable().optional(),
  /** Live enable/disable flag — pause/resume flips this. */
  enabled: z.boolean(),
  /** Output-only derived label kept for UI continuity (active / paused / completed). */
  status: z.enum(['active', 'paused', 'completed']),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ScheduledTaskEntity = z.infer<typeof ScheduledTaskEntitySchema>

export const TaskRunLogEntitySchema = z.strictObject({
  id: z.string(),
  scheduleId: z.string(),
  sessionId: z.string().nullable().optional(),
  startedAt: z.string(),
  durationMs: z.number(),
  /** JobStatus terminal set + 'running' (pending/delayed collapse to 'running' for display). */
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional()
})
export type TaskRunLogEntity = z.infer<typeof TaskRunLogEntitySchema>

// ============================================================================
// Agent DTOs (derived via .pick() from AgentEntitySchema — Rule C)
// ============================================================================

export const CreateAgentSchema = AgentEntitySchema.pick({ type: true, ...AGENT_MUTABLE_FIELDS })
export type CreateAgentDto = z.infer<typeof CreateAgentSchema>

// Update picks directly from the entity (not from Create) to avoid .default([]) bleeding into partial updates.
export const UpdateAgentSchema = AgentEntitySchema.pick(AGENT_MUTABLE_FIELDS).partial()
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>

// ============================================================================
// Task DTOs
// ============================================================================

export const CreateTaskSchema = z.strictObject({
  name: JobScheduleNameAtomSchema,
  prompt: z.string().min(1),
  trigger: TriggerSchema,
  workspace: AgentSessionWorkspaceSourceSchema,
  timeoutMinutes: TimeoutMinutesAtomSchema,
  channelIds: z.array(z.string()).optional()
})
export type CreateTaskDto = z.infer<typeof CreateTaskSchema>

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  /** Pause = false, resume = true. Replaces v1 status field. */
  enabled: z.boolean().optional()
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

export const AGENTS_DEFAULT_PAGE = 1
export const AGENTS_DEFAULT_LIMIT = 100
export const AGENTS_MAX_LIMIT = 500

/**
 * Query parameters for `GET /agents`.
 * - `search` LIKEs against `name` OR `description` (case-insensitive,
 *   wildcards in the raw input are escaped server-side).
 */
export const ListAgentsQuerySchema = z.strictObject({
  /** Free-text match against name OR description (case-insensitive LIKE). */
  search: z.string().trim().min(1).optional(),
  /** Positive integer, defaults to {@link AGENTS_DEFAULT_PAGE}. */
  page: z.int().positive().default(AGENTS_DEFAULT_PAGE),
  /** Positive integer, max {@link AGENTS_MAX_LIMIT}, defaults to {@link AGENTS_DEFAULT_LIMIT}. */
  limit: z.int().positive().max(AGENTS_MAX_LIMIT).default(AGENTS_DEFAULT_LIMIT)
})
export type ListAgentsQueryParams = z.input<typeof ListAgentsQuerySchema>
export type ListAgentsQuery = z.output<typeof ListAgentsQuerySchema>

// ============================================================================
// API Schema definitions
// ============================================================================

export type AgentSchemas = {
  /** List all agents, create a new agent */
  '/agents': {
    GET: {
      query?: ListAgentsQueryParams
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

  /** List run logs for a specific task (paginated) */
  '/agents/:agentId/tasks/:taskId/logs': {
    GET: {
      params: { agentId: string; taskId: string }
      query?: ListQuery
      response: OffsetPaginationResponse<TaskRunLogEntity>
    }
  }
}
