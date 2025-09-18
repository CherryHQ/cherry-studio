/**
 * Database entity types for Agent, Session, and SessionMessage
 * Shared between main and renderer processes
 */
import { ModelMessage, modelMessageSchema, TextStreamPart, UIMessageChunk } from 'ai'
import { z } from 'zod'

export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

export type SessionMessageRole = ModelMessage['role']

export const AgentTypeSchema = z.enum(['claude-code'])
export type AgentType = z.infer<typeof AgentTypeSchema>

export const isAgentType = (type: unknown): type is AgentType => {
  return AgentTypeSchema.safeParse(type).success
}

export type SessionMessageType = TextStreamPart<Record<string, any>>['type']

export const ToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  requirePermissions: z.boolean().optional()
})

export type Tool = z.infer<typeof ToolSchema>

export const AgentConfigurationSchema = z
  .object({
    permission_mode: PermissionModeSchema.default('default'), // Permission mode, default to 'default'
    max_turns: z.number().default(10) // Maximum number of interaction turns, default to 10
  })
  .loose()

export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>

// Shared configuration interface for both agents and sessions
export const AgentBaseSchema = z.object({
  // Basic info
  name: z.string().optional(),
  description: z.string().optional(),
  accessible_paths: z.array(z.string()), // Array of directory paths the agent can access

  // Instructions for the agent
  instructions: z.string().optional(), // System prompt

  // Models
  model: z.string(), // Main Model ID (required)
  plan_model: z.string().optional(), // Optional plan/thinking model ID
  small_model: z.string().optional(), // Optional small/fast model ID

  // Tools
  mcps: z.array(z.string()).optional(), // Array of MCP tool IDs
  allowed_tools: z.array(z.string()).optional(), // Array of allowed tool IDs (whitelist)

  // Configuration
  configuration: AgentConfigurationSchema.optional() // Extensible settings like temperature, top_p, etc.
})

export type AgentBase = z.infer<typeof AgentBaseSchema>

// Agent entity representing an autonomous agent configuration
export const AgentEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  type: AgentTypeSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})

export type AgentEntity = z.infer<typeof AgentEntitySchema>

export interface ListOptions {
  limit?: number
  offset?: number
}

// AgentSession entity representing a conversation session with one or more agents
export const AgentSessionEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  agent_id: z.string(), // Primary agent ID for the session
  agent_type: AgentTypeSchema,
  // sub_agent_ids?: string[] // Array of sub-agent IDs involved in the session

  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})

export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

// AgentSessionMessageEntity representing a message within a session
export const AgentSessionMessageEntitySchema = z.object({
  id: z.number(), // Auto-increment primary key
  session_id: z.string(), // Reference to session
  // manual defined. may not synced with ai sdk definition
  role: z.enum(['assistant', 'user', 'system', 'tool']), // 'assistant' | 'user' | 'system' | 'tool'
  content: modelMessageSchema,
  metadata: z.record(z.string(), z.any()).optional(), // Additional metadata (optional)
  created_at: z.iso.datetime(), // ISO timestamp
  updated_at: z.iso.datetime() // ISO timestamp
})

export type AgentSessionMessageEntity = z.infer<typeof AgentSessionMessageEntitySchema>

// Structured content for session messages that preserves both AI SDK and raw data
export interface SessionMessageContent {
  chunk: UIMessageChunk[] // UI-friendly AI SDK chunks for rendering
  raw: any[] // Original agent-specific messages for data integrity (agent-agnostic)
  agentResult?: any // Complete result from the underlying agent service
  agentType: string // The type of agent that generated this message (e.g., 'claude-code', 'openai', etc.)
}

export type AgentForm = {
  type: AgentType
  name: string
  description?: string
  instructions?: string
  model: string
  accessible_paths: string[]
}

// ------------------------
// API Data Transfer Object
// ------------------------
export interface CreateAgentRequest extends AgentBase {
  type: AgentType
}

export const CreateAgentResponseSchema = AgentEntitySchema

export type CreateAgentResponse = AgentEntity

export interface UpdateAgentRequest extends Partial<AgentBase> {}

export const GetAgentResponseSchema = AgentEntitySchema.extend({
  built_in_tools: z.array(ToolSchema).optional() // Built-in tools available to the agent
})

export type GetAgentResponse = z.infer<typeof GetAgentResponseSchema>

export const ListAgentsResponseSchema = z.object({
  agents: z.array(GetAgentResponseSchema),
  total: z.number()
})

export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>

export const UpdateAgentResponseSchema = GetAgentResponseSchema

export type UpdateAgentResponse = GetAgentResponse

export type CreateSessionRequest = AgentBase

export interface UpdateSessionRequest extends Partial<AgentBase> {}

export const GetAgentSessionResponseSchema = AgentSessionEntitySchema.extend({
  built_in_tools: z.array(ToolSchema).optional(), // Built-in tools available to the agent
  messages: z.array(AgentSessionMessageEntitySchema) // Messages in the session
})

export type GetAgentSessionResponse = z.infer<typeof GetAgentSessionResponseSchema>

export interface CreateSessionMessageRequest {
  content: string
}

export const AgentServerErrorSchema = z.object({
  message: z.string(),
  type: z.string(),
  code: z.string()
})

export type AgentServerError = z.infer<typeof AgentServerErrorSchema>
