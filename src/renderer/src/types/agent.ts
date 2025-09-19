/**
 * Database entity types for Agent, Session, and SessionMessage
 * Shared between main and renderer processes
 */
import { ModelMessage, modelMessageSchema, TextStreamPart } from 'ai'
import { z } from 'zod'

// ------------------ Core enums and helper types ------------------
export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

export type SessionMessageRole = ModelMessage['role']

const sessionMessageRoles = ['assistant', 'user', 'system', 'tool'] as const satisfies readonly [
  SessionMessageRole,
  ...SessionMessageRole[]
]

export const SessionMessageRoleSchema = z.enum(sessionMessageRoles)

export type SessionMessageType = TextStreamPart<Record<string, any>>['type']

export const AgentTypeSchema = z.enum(['claude-code'])
export type AgentType = z.infer<typeof AgentTypeSchema>

export const isAgentType = (type: unknown): type is AgentType => {
  return AgentTypeSchema.safeParse(type).success
}

// ------------------ Tool metadata ------------------
export const ToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  requirePermissions: z.boolean().optional()
})

export type Tool = z.infer<typeof ToolSchema>

// ------------------ Agent configuration & base schema ------------------
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

// ------------------ Persistence entities ------------------

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
  role: SessionMessageRoleSchema, // Enforce roles supported by modelMessageSchema
  content: modelMessageSchema,
  agent_session_id: z.string(), // agent session id, use to resume agent session
  metadata: z.record(z.string(), z.any()).optional(), // Additional metadata (optional)
  created_at: z.iso.datetime(), // ISO timestamp
  updated_at: z.iso.datetime() // ISO timestamp
})

export type AgentSessionMessageEntity = z.infer<typeof AgentSessionMessageEntitySchema>

// ------------------ Session message payload ------------------

// Not implemented fields:
// - plan_model: Optional model for planning/thinking tasks
// - small_model: Optional lightweight model for quick responses
// - mcps: Optional array of MCP (Model Control Protocol) tool IDs
// - allowed_tools: Optional array of permitted tool IDs
// - configuration: Optional agent settings (temperature, top_p, etc.)
// ------------------ Form models ------------------
export type BaseAgentForm = {
  id?: string
  type: AgentType
  // These fields should be editable by user.
  name: string
  description?: string
  instructions?: string
  model: string
  accessible_paths: string[]
}

export type AddAgentForm = Omit<BaseAgentForm, 'id'> & { id?: never }

export type UpdateAgentForm = Partial<Omit<BaseAgentForm, 'type'>> & {
  id: string
  type?: never
}

export type AgentForm = AddAgentForm | UpdateAgentForm

export type BaseSessionForm = AgentBase

export type CreateSessionForm = BaseSessionForm & { id?: never }

export type UpdateSessionForm = Partial<BaseSessionForm> & { id: string }

// ------------------ API data transfer objects ------------------
export interface CreateAgentRequest extends AgentBase {
  type: AgentType
}

export const CreateAgentResponseSchema = AgentEntitySchema

export type CreateAgentResponse = AgentEntity

export interface UpdateAgentRequest extends Partial<AgentBase> {}

export type ReplaceAgentRequest = AgentBase

export const GetAgentResponseSchema = AgentEntitySchema.extend({
  built_in_tools: z.array(ToolSchema).optional() // Built-in tools available to the agent
})

export type GetAgentResponse = z.infer<typeof GetAgentResponseSchema>

export const ListAgentsResponseSchema = z.object({
  data: z.array(GetAgentResponseSchema),
  total: z.int(),
  limit: z.int(),
  offset: z.int()
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

export const ListAgentSessionsResponseSchema = z.object({
  data: z.array(AgentSessionEntitySchema),
  total: z.int(),
  limit: z.int(),
  offset: z.int()
})

export type ListAgentSessionsResponse = z.infer<typeof ListAgentSessionsResponseSchema>

export interface CreateSessionMessageRequest {
  content: string
}

export const CreateSessionResponseSchema = AgentSessionEntitySchema

export type CreateSessionResponse = AgentSessionEntity

export const UpdateSessionResponseSchema = GetAgentSessionResponseSchema

export type UpdateSessionResponse = GetAgentSessionResponse

export const AgentServerErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string()
  })
})

export type AgentServerError = z.infer<typeof AgentServerErrorSchema>

// ------------------ API validation schemas ------------------

// Parameter validation schemas
export const AgentIdParamSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required')
})

export const SessionIdParamSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required')
})

// Query validation schemas
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['idle', 'running', 'completed', 'failed', 'stopped']).optional()
})

// Request body validation schemas derived from shared bases
const agentCreatableSchema = AgentBaseSchema.extend({
  name: z.string().min(1, 'Name is required'),
  model: z.string().min(1, 'Model is required')
})

export const CreateAgentRequestSchema = agentCreatableSchema.extend({
  type: AgentTypeSchema
})

export const UpdateAgentRequestSchema = AgentBaseSchema.partial()

export const ReplaceAgentRequestSchema = AgentBaseSchema

const sessionCreatableSchema = AgentBaseSchema.extend({
  model: z.string().min(1, 'Model is required')
})

export const CreateSessionRequestSchema = sessionCreatableSchema

export const UpdateSessionRequestSchema = sessionCreatableSchema.partial()

export const ReplaceSessionRequestSchema = sessionCreatableSchema

export type ReplaceSessionRequest = z.infer<typeof ReplaceSessionRequestSchema>

export const CreateSessionMessageRequestSchema = z.object({
  content: z.string().min(1, 'Content must be a valid string')
})
