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
  tools?: string[] // Array of enabled tool IDs
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
  agent_id: string // Agent ID involved
  user_goal?: string // Initial user goal for the session
  status: SessionStatus
  accessible_paths?: string[] // Array of directory paths the agent can access
  agent_session_id?: string // Latest Claude SDK session ID for continuity
  max_turns?: number // Maximum number of turns allowed in the session, default 10
  permission_mode?: PermissionMode // Permission mode for the session
  created_at: string
  updated_at: string
}
