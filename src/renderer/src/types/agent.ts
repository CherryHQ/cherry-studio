/**
 * Database entity types for Agent, Session, and SessionLog
 * Shared between main and renderer processes
 */

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
  is_deleted: number
}

export interface SessionEntity {
  id: string
  agent_ids: string[] // Array of agent IDs involved (supports multi-agent scenarios)
  user_prompt?: string // Initial user goal for the session
  status: SessionStatus
  accessible_paths?: string[] // Array of directory paths the agent can access
  created_at: string
  updated_at: string
  is_deleted: number
}

export interface SessionLogEntity {
  id: number // Auto-increment primary key
  session_id: string
  parent_id?: number // For tree structure of logs
  role: SessionLogRole
  type: SessionLogType
  content: Record<string, any> // JSON structured data
  created_at: string
}

// Enums and union types
export type SessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
export type SessionLogRole = 'user' | 'agent'
export type SessionLogType = 'message' | 'thought' | 'action' | 'observation'

// Input/Output DTOs for API operations
export interface CreateAgentInput {
  name: string
  description?: string
  avatar?: string
  instructions?: string
  model: string
  tools?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
}

export interface UpdateAgentInput {
  id: string
  name?: string
  description?: string
  avatar?: string
  instructions?: string
  model?: string
  tools?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
}

export interface CreateSessionInput {
  agent_ids: string[]
  user_prompt?: string
  status?: SessionStatus
  accessible_paths?: string[]
}

export interface UpdateSessionInput {
  id: string
  agent_ids?: string[]
  user_prompt?: string
  status?: SessionStatus
  accessible_paths?: string[]
}

export interface CreateSessionLogInput {
  session_id: string
  parent_id?: number
  role: SessionLogRole
  type: SessionLogType
  content: Record<string, any>
}

// Response DTOs
export interface AgentResponse extends Omit<AgentEntity, 'tools' | 'knowledges' | 'configuration' | 'is_deleted'> {
  tools: string[]
  knowledges: string[]
  configuration: Record<string, any>
}

export interface SessionResponse extends Omit<SessionEntity, 'agent_ids' | 'accessible_paths' | 'is_deleted'> {
  agent_ids: string[]
  accessible_paths: string[]
}

export interface SessionLogResponse extends SessionLogEntity {}

// List/Search options
export interface ListAgentsOptions {
  limit?: number
  offset?: number
}

export interface ListSessionsOptions {
  limit?: number
  offset?: number
  status?: SessionStatus
}

export interface ListSessionLogsOptions {
  session_id: string
  limit?: number
  offset?: number
}

// Service result types
export interface ServiceResult<T> {
  success: boolean
  data?: T
  error?: string
}

export interface ListResult<T> {
  items: T[]
  total: number
}

// Content types for session logs
export interface MessageContent {
  text: string
}

export interface ThoughtContent {
  text: string
  reasoning?: string
}

export interface ActionContent {
  tool: string
  input: Record<string, any>
  description?: string
}

export interface ObservationContent {
  result: any
  success: boolean
  error?: string
}
