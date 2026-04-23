/**
 * Agent domain entity types
 *
 * Pure TypeScript interfaces for the agents service domain — no runtime
 * dependencies (Zod, etc.). Used by the DataApi schema and shared between
 * main and renderer.
 */

// ============================================================================
// Core agent types
// ============================================================================

export type AgentType = 'claude-code'

export type TaskScheduleType = 'cron' | 'interval' | 'once'

export type TaskStatus = 'active' | 'paused' | 'completed'

export type SessionMessageRole = 'user' | 'assistant' | 'tool' | 'system'

/** Extensible per-agent configuration (open-ended object) */
export type AgentConfiguration = Record<string, unknown>

export interface SlashCommand {
  command: string
  description?: string
}

// ============================================================================
// Agent entity
// ============================================================================

/** Core agent fields shared between agent and session */
export interface AgentBase {
  name?: string
  description?: string
  /** Directories accessible to the agent (empty = default workspace) */
  accessiblePaths: string[]
  instructions?: string
  model: string
  planModel?: string
  smallModel?: string
  mcps?: string[]
  allowedTools?: string[]
  configuration?: AgentConfiguration
}

/** Persisted agent record */
export interface AgentEntity extends AgentBase {
  id: string
  type: AgentType
  createdAt: string
  updatedAt: string
}

/** Agent entity with resolved tools list */
export interface AgentDetail extends AgentEntity {
  tools?: Array<{ id: string; name: string; description?: string }>
}

/** @deprecated Use `OffsetPaginationResponse<AgentDetail>` from `@shared/data/api`. Remove once #14431 rebinds renderer to DataApi. */
export interface ListAgentsResponse {
  data: AgentDetail[]
  total: number
  limit: number
  offset: number
}

// ============================================================================
// Session entity
// ============================================================================

/** Persisted session record */
export interface AgentSessionEntity extends AgentBase {
  id: string
  agentId: string
  agentType: AgentType
  slashCommands?: SlashCommand[]
  createdAt: string
  updatedAt: string
}

/** Session with resolved tools, messages, and plugins */
export interface AgentSessionDetail extends AgentSessionEntity {
  tools?: Array<{ id: string; name: string; description?: string }>
  messages?: AgentSessionMessageEntity[]
  plugins?: Array<{
    filename: string
    type: 'agent' | 'command' | 'skill'
    metadata: Record<string, unknown>
  }>
}

/** @deprecated Use `OffsetPaginationResponse<AgentSessionEntity>` from `@shared/data/api`. Remove once #14431 rebinds renderer to DataApi. */
export interface ListAgentSessionsResponse {
  data: AgentSessionEntity[]
  total: number
  limit: number
  offset: number
}

// ============================================================================
// Session message entity
// ============================================================================

export interface AgentSessionMessageEntity {
  id: number
  sessionId: string
  role: SessionMessageRole
  content: unknown
  agentSessionId: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ListSessionMessagesResponse {
  messages: AgentSessionMessageEntity[]
}

// ============================================================================
// Task entity
// ============================================================================

export interface ScheduledTaskEntity {
  id: string
  agentId: string
  name: string
  prompt: string
  scheduleType: TaskScheduleType
  scheduleValue: string
  timeoutMinutes: number
  channelIds?: string[]
  nextRun?: string | null
  lastRun?: string | null
  lastResult?: string | null
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

/** @deprecated Use `OffsetPaginationResponse<ScheduledTaskEntity>` from `@shared/data/api`. Remove once #14431 rebinds renderer to DataApi. */
export interface ListTasksResponse {
  data: ScheduledTaskEntity[]
  total: number
  limit: number
  offset: number
}

// ============================================================================
// Skill entity
// ============================================================================

export interface InstalledSkill {
  id: string
  name: string
  description: string | null
  folderName: string
  source: string
  sourceUrl: string | null
  namespace: string | null
  author: string | null
  tags: string[]
  contentHash: string
  isEnabled: boolean
  createdAt: number
  updatedAt: number
}

export interface ListSkillsResponse {
  data: InstalledSkill[]
}
