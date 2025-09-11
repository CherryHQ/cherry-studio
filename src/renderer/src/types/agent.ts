/**
 * Database entity types for Agent, Session, and SessionLog
 * Shared between main and renderer processes
 */

// Agent entity representing an autonomous agent configuration
export interface AgentEntity {
  id: string
  name: string
  description?: string
  avatar?: string

  instructions?: string // System prompt

  model: string // Model ID (required)
  plan_model?: string // Optional plan/thinking model ID
  small_model?: string // Optional small/fast model ID

  built_in_tools?: string[] // Array of built-in tool IDs
  mcps?: string[] // Array of MCP tool IDs

  knowledges?: string[] // Array of enabled knowledge base IDs
  configuration?: Record<string, any> // Extensible settings like temperature, top_p
  created_at: string
  updated_at: string
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
export type PermissionMode = 'readOnly' | 'acceptEdits' | 'bypassPermissions'

// AgentSession entity representing a conversation session with one or more agents
export interface AgentSessionEntity {
  id: string
  main_agent_id: string // Primary agent ID for the session
  sub_agent_ids?: string[] // Array of sub-agent IDs involved in the session
  user_goal?: string // Initial user goal for the session
  status: SessionStatus
  accessible_paths?: string[] // Array of directory paths the agent can access
  external_session_id?: string // Agent session for external agent management/tracking
  max_steps?: number // Maximum number of steps the agent can take, default 10
  permission_mode?: PermissionMode // Permission mode for the session
  created_at: string
  updated_at: string
}
