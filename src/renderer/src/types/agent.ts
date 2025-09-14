/**
 * Database entity types for Agent, Session, and SessionMessage
 * Shared between main and renderer processes
 */

export type SessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
export type PermissionMode = 'readOnly' | 'acceptEdits' | 'bypassPermissions'
export type SessionMessageRole = 'user' | 'agent' | 'system' | 'tool'
export type AgentType = 'claude-code' | 'codex' | 'qwen-cli' | 'gemini-cli' | 'custom'

export function isAgentType(value: string): value is AgentType {
  return ['claude-code', 'codex', 'qwen-cli', 'gemini-cli', 'custom'].includes(value)
}

export type SessionMessageType =
  | 'message' // User or agent message
  | 'thought' // Agent's internal reasoning/planning
  | 'action' // Tool/function call initiated
  | 'observation' // Result from tool/function
  | 'error' // Error occurred during execution
  | 'plan' // Planning/strategy phase
  | 'summary' // Summarization of steps
  | 'status_change' // Session status changed
  | 'tool_call' // Specific tool invocation
  | 'tool_result' // Tool execution result
  | 'completion' // Task/step completion
  | 'interrupt' // User interrupted execution

// Shared configuration interface for both agents and sessions
export interface AgentConfiguration {
  model: string // Main Model ID (required)
  plan_model?: string // Optional plan/thinking model ID
  small_model?: string // Optional small/fast model ID
  built_in_tools?: string[] // Array of built-in tool IDs
  mcps?: string[] // Array of MCP tool IDs
  knowledges?: string[] // Array of enabled knowledge base IDs
  configuration?: Record<string, any> // Extensible settings like temperature, top_p
  accessible_paths?: string[] // Array of directory paths the agent can access
  permission_mode?: PermissionMode // Permission mode
  max_steps?: number // Maximum number of steps the agent can take
}

// Agent entity representing an autonomous agent configuration
export interface AgentEntity extends AgentConfiguration {
  id: string
  type: AgentType
  name: string
  description?: string
  avatar?: string
  instructions?: string // System prompt
  created_at: string
  updated_at: string
}

// AgentSession entity representing a conversation session with one or more agents
export interface AgentSessionEntity extends AgentConfiguration {
  id: string
  name?: string // Session name
  main_agent_id: string // Primary agent ID for the session
  sub_agent_ids?: string[] // Array of sub-agent IDs involved in the session
  user_goal?: string // Initial user goal for the session
  status: SessionStatus
  external_session_id?: string // Agent session for external agent management/tracking
  messages?: SessionMessageEntity[] // Hierarchical session messages
  created_at: string
  updated_at: string
}

// SessionMessage entity for tracking all agent activities
export interface SessionMessageEntity {
  id: number // Auto-increment primary key
  session_id: string // Reference to session
  parent_id?: number // For tree structure (e.g., tool calls under an action)
  role: SessionMessageRole // 'user', 'agent', 'system', 'tool'
  type: SessionMessageType // Type of log entry
  content: string | Record<string, any> // JSON structured data
  metadata?: Record<string, any> // Additional metadata (optional)
  created_at: string // ISO timestamp
  updated_at: string // ISO timestamp
}
