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

export type AgentType = 'assistant' | 'claw'

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
  accessible_paths: string[]
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  slash_commands?: SlashCommand[]
  configuration?: AgentConfiguration
}

/** Persisted agent record */
export interface AgentEntity extends AgentBase {
  id: string
  type: AgentType
  created_at: string
  updated_at: string
}

/** Agent entity with resolved tools list */
export interface AgentDetail extends AgentEntity {
  tools?: Array<{ id: string; name: string; description?: string }>
}

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
  agent_id: string
  agent_type: AgentType
  created_at: string
  updated_at: string
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
  session_id: string
  role: SessionMessageRole
  content: unknown
  agent_session_id: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ListSessionMessagesResponse {
  messages: AgentSessionMessageEntity[]
}

// ============================================================================
// Task entity
// ============================================================================

export interface ScheduledTaskEntity {
  id: string
  agent_id: string
  name: string
  prompt: string
  schedule_type: TaskScheduleType
  schedule_value: string
  timeout_minutes: number
  channel_ids?: string[]
  next_run?: string | null
  last_run?: string | null
  last_result?: string | null
  status: TaskStatus
  created_at: string
  updated_at: string
}

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
