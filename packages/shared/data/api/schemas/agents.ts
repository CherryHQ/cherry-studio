/**
 * Agents domain API Schema definitions
 *
 * Covers agents, sessions, session messages, scheduled tasks, and skills.
 * Entity schemas live here (Rule C/D: entity role wins when a type is both
 * a response payload and an entity). DTOs are derived via .pick().
 */

import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'

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
  description: z.string().optional(),
  /** Source of the tool — set on builtin / MCP / user-custom catalog entries.
   *  API responses currently omit this; settings UIs / claudecode catalog read it. */
  type: z.enum(['builtin', 'mcp', 'custom']).optional(),
  /** Requires user approval before invocation (UI-only hint). */
  requirePermissions: z.boolean().optional()
})
export type AgentTool = z.infer<typeof AgentToolSchema>

export const AgentPermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
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
// Agent entity schemas (Rule C: entity schemas live in packages/shared/data/api/schemas/)
// ============================================================================

/** Core mutable fields on an agent (the cognitive blueprint). Workspace
 *  (`accessiblePaths`) is intentionally NOT here — that's bound to a session at
 *  create time, see `AgentSessionEntitySchema.accessiblePaths`. */
export const AgentBaseSchema = z.strictObject({
  name: AgentNameAtomSchema,
  description: z.string().optional(),
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
  model: ModelIdAtomSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Human-readable primary model name resolved from `user_model.name` at read
   * time. Edits still go through the `model` UniqueModelId field.
   */
  modelName: z.string().nullable()
})
export type AgentEntity = z.infer<typeof AgentEntitySchema>

export const AgentDetailSchema = AgentEntitySchema.extend({
  tools: z.array(AgentToolSchema).optional()
})
export type AgentDetail = z.infer<typeof AgentDetailSchema>

export const AgentSessionMessageEntitySchema = z.strictObject({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.unknown(),
  agentSessionId: z.string().nullable(),
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

export const TaskRunLogEntitySchema = z.strictObject({
  id: z.string(),
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
  /** Skill metadata tags from SKILL.md. */
  sourceTags: z.array(z.string()).default([]),
  contentHash: z.string(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type InstalledSkill = z.infer<typeof InstalledSkillSchema>

// ============================================================================
// Agent DTOs (derived via .pick() from AgentEntitySchema — Rule C)
// ============================================================================

// `model` re-required because the picked entity field is optional (FK SET NULL).
export const CreateAgentSchema = AgentEntitySchema.pick({ type: true, ...AGENT_MUTABLE_FIELDS }).extend({
  model: ModelIdAtomSchema
})
export type CreateAgentDto = z.infer<typeof CreateAgentSchema>

// Update picks directly from the entity (not from Create) to avoid .default([]) bleeding into partial updates.
export const UpdateAgentSchema = AgentEntitySchema.pick(AGENT_MUTABLE_FIELDS).partial()
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>

// Session DTOs / list query / route schemas live in `./sessions.ts`.

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

export const LIST_QUERY_DEFAULT_PAGE = 1
export const LIST_QUERY_DEFAULT_LIMIT = 50
export const LIST_QUERY_MAX_LIMIT = 500

export const ListQuerySchema = z.strictObject({
  page: z.number().int().positive().default(LIST_QUERY_DEFAULT_PAGE),
  limit: z.number().int().positive().max(LIST_QUERY_MAX_LIMIT).default(LIST_QUERY_DEFAULT_LIMIT)
})
/** Wire-side (caller) shape — page/limit optional, defaults applied on parse. */
export type ListQuery = z.input<typeof ListQuerySchema>

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

/**
 * Query parameters for `GET /skills`.
 *
 * Skills keep their historical direct-array response shape (no pagination UI
 * in the resource library yet), but filtering must still happen in the service
 * SQL layer:
 * - `agentId` only controls per-agent `isEnabled` decoration.
 * - `search` LIKEs against `name` OR `description`.
 */
export const ListSkillsQuerySchema = z.strictObject({
  agentId: z.string().min(1).optional(),
  search: z.string().trim().min(1).optional()
})
export type ListSkillsQueryParams = z.input<typeof ListSkillsQuerySchema>
export type ListSkillsQuery = z.output<typeof ListSkillsQuerySchema>

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

  /** List all installed skills (optionally filtered by agent) */
  '/skills': {
    GET: {
      query?: ListSkillsQueryParams
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

  /** List run logs for a specific task (paginated) */
  '/agents/:agentId/tasks/:taskId/logs': {
    GET: {
      params: { agentId: string; taskId: string }
      query?: ListQuery
      response: OffsetPaginationResponse<TaskRunLogEntity>
    }
  }
} & OrderEndpoints<'/agents'>
