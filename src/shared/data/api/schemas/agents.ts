/**
 * Agents domain API Schema definitions
 *
 * Covers agents and scheduled tasks.
 * Entity schemas live here (Rule C/D: entity role wins when a type is both
 * a response payload and an entity). DTOs are derived via .pick().
 */

import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { ServiceTierSelectionSchema, UniqueModelIdSchema } from '@shared/data/types/model'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'
import * as z from 'zod'

import type { OffsetPaginationResponse } from '../types'
import type { OrderEndpoints } from './_endpointHelpers'
import { AgentSessionWorkspaceSourceSchema } from './agentWorkspaces'
import { TriggerSchema } from './jobs'

// ============================================================================
// Field atoms (shared validators reused across entity and DTO schemas)
// ============================================================================

export const AgentNameAtomSchema = z.string().min(1)
export const ModelIdAtomSchema = z.string().min(1)
export const TimeoutMinutesAtomSchema = z.number().min(1).nullable().optional()
export const AgentToolNameSetSchema = z.array(z.string()).transform((items) => Array.from(new Set(items)))
export const AgentSkillIdSetSchema = z.array(z.string().min(1)).transform((items) => Array.from(new Set(items)))
export const AgentKnowledgeBaseIdSetSchema = z.array(z.string().min(1)).transform((items) => Array.from(new Set(items)))
export const AgentSkillUpdateSchema = z.strictObject({
  skillId: z.string().min(1),
  isEnabled: z.boolean()
})
export const AgentSkillUpdateListSchema = z.array(AgentSkillUpdateSchema).transform((items) => {
  const bySkillId = new Map<string, z.infer<typeof AgentSkillUpdateSchema>>()
  for (const item of items) bySkillId.set(item.skillId, item)
  return Array.from(bySkillId.values())
})
export type AgentSkillUpdateDto = z.infer<typeof AgentSkillUpdateSchema>

export const AgentPermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'])
export type AgentPermissionMode = z.infer<typeof AgentPermissionModeSchema>
export const AGENT_TYPES = ['claude-code', 'pi', 'dsh'] as const
export const AgentTypeSchema = z.enum(AGENT_TYPES)
export type AgentType = z.infer<typeof AgentTypeSchema>
export const AgentSchedulerTypeSchema = z.enum(['cron', 'interval', 'one-time'])

export const AgentConfigurationSchema = z
  .object({
    avatar: z.string().optional(),
    slash_commands: z.array(z.string()).optional(),
    permission_mode: AgentPermissionModeSchema.optional(),
    reasoning_effort: ReasoningEffortOptionSchema.optional(),
    service_tier: ServiceTierSelectionSchema.optional(),
    env_vars: z.record(z.string(), z.string()).optional(),
    bootstrap_completed: z.boolean().optional(),
    scheduler_enabled: z.boolean().optional(),
    scheduler_type: AgentSchedulerTypeSchema.optional(),
    scheduler_cron: z.string().optional(),
    scheduler_interval: z.number().optional(),
    scheduler_one_time_delay: z.number().optional(),
    scheduler_last_run: z.string().optional(),
    heartbeat_enabled: z.boolean().optional(),
    heartbeat_interval: z.number().optional(),
    builtin_role: z.enum([BUILTIN_AGENT_ROLE.ASSISTANT, BUILTIN_AGENT_ROLE.SUPPORT]).optional()
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
 * type mismatch (e.g. `heartbeat_interval: "5"`) into the response, defeating downstream
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
  planModel: UniqueModelIdSchema.optional(),
  smallModel: UniqueModelIdSchema.optional(),
  mcps: z.array(z.string()).optional(),
  /** Knowledge base IDs linked through agent_knowledge_base. Empty = kb_* tools are not exposed to the agent. */
  knowledgeBaseIds: AgentKnowledgeBaseIdSetSchema.optional(),
  /** Opt-out list of disabled tool names (empty = all enabled). Drives SDK disallowedTools and PreToolUse denial. */
  disabledTools: AgentToolNameSetSchema.optional(),
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
  knowledgeBaseIds: true,
  disabledTools: true,
  configuration: true
} as const

export const AgentEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  type: AgentTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Persistent ordering key. Read-only; modified only through order endpoints. */
  orderKey: z.string(),
  model: UniqueModelIdSchema.nullable(),
  /**
   * Human-readable primary model name resolved from the current runtime Model
   * at read time. Edits still go through the `model` UniqueModelId field.
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
  /**
   * When true, every fire continues the same agent session instead of creating
   * a fresh one. Off by default — a sticky session accumulates context without
   * bound, which is why the scheduler creates a new session per fire otherwise.
   */
  reuseSession: z.boolean(),
  /** The sticky session bound by the last fire; null until the first fire (or while `reuseSession` is off). */
  reuseSessionId: z.string().nullable(),
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
export type TaskRunSummary =
  | { status: 'queued' }
  | { status: 'running' }
  | { status: 'completed' | 'failed' | 'cancelled'; finishedAt: string }
export type ScheduledTaskListItem = ScheduledTaskEntity & { runSummary: TaskRunSummary | null }

export const TaskRunLogEntitySchema = z.strictObject({
  id: z.string(),
  scheduleId: z.string(),
  sessionId: z.string().nullable().optional(),
  startedAt: z.string(),
  /** null while unfinished and for runs that never started (no queue-wait shown as duration). */
  durationMs: z.number().nullable(),
  /** JobStatus terminal set + 'running' (pending/delayed collapse to 'running' for display). */
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional()
})
export type TaskRunLogEntity = z.infer<typeof TaskRunLogEntitySchema>

// ============================================================================
// Agent update DTOs (derived via .pick() from AgentEntitySchema — Rule C)
// ============================================================================

/**
 * DTO for updating an existing agent. All fields are optional.
 *
 * `configuration` is itself a partial: callers send only the first-level keys
 * they intend to change, and AgentService shallow-merges them onto the latest
 * persisted configuration inside the write transaction. Nested values such as
 * `env_vars` still replace as a whole. An explicitly present `undefined` value
 * removes that configuration key; omission preserves it.
 */
export const UpdateAgentSchema = AgentEntitySchema.pick(AGENT_MUTABLE_FIELDS).partial().extend({
  configuration: AgentConfigurationSchema.partial().optional(),
  /**
   * Per-skill enablement changes for this agent. Omitted means "leave skills
   * unchanged"; an empty array is a no-op. The server applies each update
   * without replacing unrelated skill rows.
   */
  skillUpdates: AgentSkillUpdateListSchema.optional()
})
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>

// Agent creation and task command schemas live on IpcApi (`ai.agent.*` in
// `@shared/ipc/schemas/ai`) because those mutations have non-database effects.

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
 *   wildcards in the raw input are escaped server-side), including the localized
 *   builtin Cherry Assistant fallback when its stored description is blank.
 */
export const ListAgentsQuerySchema = z.strictObject({
  /** Free-text match against name OR description, including builtin fallback text (case-insensitive LIKE). */
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
  /** List all agents. Creation is a mixed filesystem + DB command on IpcApi (`ai.agent.create`). */
  '/agents': {
    GET: {
      query?: ListAgentsQueryParams
      response: OffsetPaginationResponse<AgentEntity>
    }
  }

  /** Get or update a specific agent. Use `ai.agent.delete` on IpcApi for
      the full agent + session + pin cascade; the data-API DELETE here
      removes the agent only and is intended for the resource-list UI. */
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
      response: undefined
    }
  }

  /** List scheduled tasks across every agent (settings overview, paginated) */
  '/agent-tasks': {
    GET: {
      query?: ListQuery
      response: OffsetPaginationResponse<ScheduledTaskListItem>
    }
  }

  /** Get a scheduled task without requiring its owning Agent in the route */
  '/agent-tasks/:taskId': {
    GET: {
      params: { taskId: string }
      response: ScheduledTaskEntity
    }
  }

  /** List tasks for an agent (mutations live on IpcApi `ai.agent.task.*`) */
  '/agents/:agentId/tasks': {
    GET: {
      params: { agentId: string }
      query?: ListQuery
      response: OffsetPaginationResponse<ScheduledTaskEntity>
    }
  }

  /** Get a specific task */
  '/agents/:agentId/tasks/:taskId': {
    GET: {
      params: { agentId: string; taskId: string }
      response: ScheduledTaskEntity
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
