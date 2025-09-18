/**
 * Database entity types for Agent, Session, and SessionMessage
 * Shared between main and renderer processes
 */
import { ModelMessage, TextStreamPart, UIMessageChunk } from 'ai'
import { z } from 'zod'

export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

export type SessionMessageRole = ModelMessage['role']
export type AgentType = 'claude-code'

export const isAgentType = (type: string): type is AgentType => {
  return ['claude-code'].includes(type)
}

export type SessionMessageType = TextStreamPart<Record<string, any>>['type']

export interface Tool {
  id: string
  name: string
  description?: string
  requirePermissions?: boolean
}

export interface AgentConfiguration extends Record<string, any> {
  permission_mode: PermissionMode // Permission mode, default to 'default'
  max_turns: number // Maximum number of interaction turns, default to 10
}

// Shared configuration interface for both agents and sessions
export interface AgentBase {
  // Basic info
  name?: string
  description?: string
  accessible_paths: string[] // Array of directory paths the agent can access

  // Instructions for the agent
  instructions?: string // System prompt

  // Models
  model: string // Main Model ID (required)
  plan_model?: string // Optional plan/thinking model ID
  small_model?: string // Optional small/fast model ID

  // Tools
  mcps?: string[] // Array of MCP tool IDs
  allowed_tools?: string[] // Array of allowed tool IDs (whitelist)

  // Configuration
  configuration?: AgentConfiguration // Extensible settings like temperature, top_p, etc.
}

// Agent entity representing an autonomous agent configuration
export interface AgentEntity extends AgentBase {
  id: string
  type: AgentType
  created_at: string
  updated_at: string
}

export interface ListOptions {
  limit?: number
  offset?: number
}

// AgentSession entity representing a conversation session with one or more agents
export interface AgentSessionEntity extends AgentBase {
  id: string
  agent_id: string // Primary agent ID for the session
  agent_type: AgentType
  // sub_agent_ids?: string[] // Array of sub-agent IDs involved in the session

  created_at: string
  updated_at: string
}

// AgentSessionMessageEntity representing a message within a session
export interface AgentSessionMessageEntity {
  id: number // Auto-increment primary key
  session_id: string // Reference to session
  role: ModelMessage['role'] // 'assistant' | 'user' | 'system' | 'tool'
  content: ModelMessage
  metadata?: Record<string, any> // Additional metadata (optional)
  created_at: string // ISO timestamp
  updated_at: string // ISO timestamp
}

// Structured content for session messages that preserves both AI SDK and raw data
export interface SessionMessageContent {
  chunk: UIMessageChunk[] // UI-friendly AI SDK chunks for rendering
  raw: any[] // Original agent-specific messages for data integrity (agent-agnostic)
  agentResult?: any // Complete result from the underlying agent service
  agentType: string // The type of agent that generated this message (e.g., 'claude-code', 'openai', etc.)
}

// ------------------------
// API Data Transfer Object
// ------------------------
export interface CreateAgentRequest extends AgentBase {
  type: AgentType
}

export interface UpdateAgentRequest extends Partial<AgentBase> {}

export interface GetAgentResponse extends AgentEntity {
  built_in_tools?: Tool[] // Built-in tools available to the agent
}

export type CreateSessionRequest = AgentBase

export interface UpdateSessionRequest extends Partial<AgentBase> {}

export interface GetAgentSessionResponse extends AgentSessionEntity {
  built_in_tools?: Tool[] // Built-in tools available to the agent
  messages: AgentSessionMessageEntity[] // Messages in the session
}

export interface CreateSessionMessageRequest {
  content: string
}
