/**
 * Database entity types for Agent, Session, and SessionMessage
 * Shared between main and renderer processes
 *
 * WARNING: Any null value will be converted to undefined from api.
 */
import type { ModelMessage, TextStreamPart } from 'ai'
import * as z from 'zod'

import type { Message, MessageBlock } from './newMessage'
import { InstalledPluginSchema, PluginMetadataSchema } from './plugin'

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

export const AgentTypeSchema = z.enum(['claude-code', 'cherry-claw'])
export type AgentType = z.infer<typeof AgentTypeSchema>

// ------------------ CherryClaw-specific types ------------------
export const SchedulerTypeSchema = z.enum(['cron', 'interval', 'one-time'])
export type SchedulerType = z.infer<typeof SchedulerTypeSchema>

export const TelegramChannelConfigSchema = z.object({
  bot_token: z.string().min(1),
  allowed_chat_ids: z.array(z.string()).default([])
})

export type TelegramChannelConfig = z.infer<typeof TelegramChannelConfigSchema>

export const CherryClawChannelSchema = z.object({
  id: z.string(),
  type: z.enum(['telegram']),
  name: z.string(),
  enabled: z.boolean().default(true),
  config: z.union([TelegramChannelConfigSchema]),
  is_notify_receiver: z.boolean().default(false)
})

export type CherryClawChannel = z.infer<typeof CherryClawChannelSchema>

export const isAgentType = (type: unknown): type is AgentType => {
  return AgentTypeSchema.safeParse(type).success
}

// ------------------ Tool metadata ------------------
export const ToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['builtin', 'mcp', 'custom']),
  description: z.string().optional(),
  requirePermissions: z.boolean().optional()
})

export type Tool = z.infer<typeof ToolSchema>

export const SlashCommandSchema = z.object({
  command: z.string(), // e.g. '/status'
  description: z.string().optional() // e.g. 'Show help information'
})

export type SlashCommand = z.infer<typeof SlashCommandSchema>

// ------------------ Agent configuration & base schema ------------------
export const AgentConfigurationSchema = z
  .object({
    avatar: z.string().optional(), // agent type as mark of default avatar; single emoji; URL or path to avatar image.
    slash_commands: z.array(z.string()).optional(), // Array of slash commands to trigger the agent, this is from agent init response

    // https://docs.claude.com/en/docs/claude-code/sdk/sdk-permissions#mode-specific-behaviors
    permission_mode: PermissionModeSchema.optional().default('default'), // Permission mode, default to 'default'
    max_turns: z.number().optional().default(100) // Maximum number of interaction turns, default to 100
  })
  .loose()

export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>

// CherryClaw extends AgentConfiguration with scheduler/soul/heartbeat fields.
// Since AgentConfigurationSchema uses .loose(), these are stored in the same JSON field.
export type CherryClawConfiguration = AgentConfiguration & {
  // Soul
  soul_enabled?: boolean

  // Scheduler
  scheduler_enabled?: boolean
  scheduler_type?: SchedulerType
  scheduler_cron?: string
  scheduler_interval?: number
  scheduler_one_time_delay?: number
  scheduler_last_run?: string

  // Heartbeat
  heartbeat_enabled?: boolean
  heartbeat_file?: string

  // Channels (placeholder)
  channels?: CherryClawChannel[]
}

// ------------------ Scheduled Task types ------------------
export const TaskScheduleTypeSchema = z.enum(['cron', 'interval', 'once'])
export type TaskScheduleType = z.infer<typeof TaskScheduleTypeSchema>

export const TaskStatusSchema = z.enum(['active', 'paused', 'completed'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TaskContextModeSchema = z.enum(['session', 'isolated'])
export type TaskContextMode = z.infer<typeof TaskContextModeSchema>

export const ScheduledTaskEntitySchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  prompt: z.string(),
  schedule_type: TaskScheduleTypeSchema,
  schedule_value: z.string(),
  context_mode: TaskContextModeSchema,
  next_run: z.string().nullable().optional(),
  last_run: z.string().nullable().optional(),
  last_result: z.string().nullable().optional(),
  status: TaskStatusSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})

export type ScheduledTaskEntity = z.infer<typeof ScheduledTaskEntitySchema>

export const TaskRunLogEntitySchema = z.object({
  id: z.number(),
  task_id: z.string(),
  run_at: z.string(),
  duration_ms: z.number(),
  status: z.enum(['success', 'error']),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional()
})

export type TaskRunLogEntity = z.infer<typeof TaskRunLogEntitySchema>

// Shared configuration interface for both agents and sessions
export const AgentBaseSchema = z.object({
  // Basic info
  name: z.string().optional(),
  description: z.string().optional(),
  accessible_paths: z.array(z.string()), // Array of directory paths the agent can access (empty = use default workspace)

  // Instructions for the agent
  instructions: z.string().optional(), // System prompt

  // Models
  model: z.string(), // Main Model ID (required)
  plan_model: z.string().optional(), // Optional plan/thinking model ID
  small_model: z.string().optional(), // Optional small/fast model ID

  // Tools
  mcps: z.array(z.string()).optional(), // Array of MCP tool IDs
  allowed_tools: z.array(z.string()).optional(), // Array of allowed tool IDs (whitelist)
  slash_commands: z.array(SlashCommandSchema).optional(), // Array of slash commands merged from builtin and SDK

  // Configuration
  configuration: AgentConfigurationSchema.optional() // Extensible settings like temperature, top_p, etc.
})

export type AgentBase = z.infer<typeof AgentBaseSchema>

export const isAgentBase = (value: unknown): value is AgentBase => {
  return AgentBaseSchema.safeParse(value).success
}

export const AgentBaseWithIdSchema = AgentBaseSchema.extend({
  id: z.string()
})

export type AgentBaseWithId = z.infer<typeof AgentBaseWithIdSchema>

export const isAgentBaseWithId = (value: unknown): value is AgentBaseWithId => {
  return AgentBaseWithIdSchema.safeParse(value).success
}

// ------------------ Persistence entities ------------------

// Agent entity representing an autonomous agent configuration
export const AgentEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  type: AgentTypeSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})

export type AgentEntity = z.infer<typeof AgentEntitySchema>

export const isAgentEntity = (value: unknown): value is AgentEntity => {
  return AgentEntitySchema.safeParse(value).success
}

export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: 'created_at' | 'updated_at' | 'name'
  orderBy?: 'asc' | 'desc'
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

export const isAgentSessionEntity = (value: unknown): value is AgentSessionEntity => {
  return AgentSessionEntitySchema.safeParse(value).success
}

// AgentSessionMessageEntity representing a message within a session
export const AgentSessionMessageEntitySchema = z.object({
  id: z.number(), // Auto-increment primary key
  session_id: z.string(), // Reference to session
  // manual defined. may not synced with ai sdk definition
  role: SessionMessageRoleSchema,
  content: z.unknown(),
  agent_session_id: z.string(), // agent session id, use to resume agent session
  metadata: z.record(z.string(), z.any()).optional(), // Additional metadata (optional)
  created_at: z.iso.datetime(), // ISO timestamp
  updated_at: z.iso.datetime() // ISO timestamp
})

export type AgentSessionMessageEntity = z.infer<typeof AgentSessionMessageEntitySchema>

export interface AgentPersistedMessage {
  message: Message
  blocks: MessageBlock[]
}

export interface AgentMessageUserPersistPayload {
  payload: AgentPersistedMessage
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface AgentMessageAssistantPersistPayload {
  payload: AgentPersistedMessage
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface AgentMessagePersistExchangePayload {
  sessionId: string
  agentSessionId: string
  user?: AgentMessageUserPersistPayload
  assistant?: AgentMessageAssistantPersistPayload
}

export interface AgentMessagePersistExchangeResult {
  userMessage?: AgentSessionMessageEntity
  assistantMessage?: AgentSessionMessageEntity
}

// ------------------ Session message payload ------------------

// Not implemented fields:
// - plan_model: Optional model for planning/thinking tasks
// - small_model: Optional lightweight model for quick responses
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
  allowed_tools: string[]
  mcps?: string[]
  configuration?: AgentConfiguration
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

export type SessionForm = CreateSessionForm | UpdateSessionForm

export type UpdateAgentBaseForm = Partial<AgentBase> & { id: string }

// --------------------- Components & Hooks ----------------------

export type UpdateAgentBaseOptions = {
  /** Whether to show success toast after updating. Defaults to true. */
  showSuccessToast?: boolean
}

export type UpdateAgentFunction = (
  form: UpdateAgentForm,
  options?: UpdateAgentBaseOptions
) => Promise<AgentEntity | undefined>

export type UpdateAgentSessionFunction = (
  form: UpdateSessionForm,
  options?: UpdateAgentBaseOptions
) => Promise<AgentSessionEntity | undefined>

export type UpdateAgentFunctionUnion = UpdateAgentFunction | UpdateAgentSessionFunction

// ------------------ API data transfer objects ------------------
export interface CreateAgentRequest extends AgentBase {
  type: AgentType
}

export const CreateAgentResponseSchema = AgentEntitySchema

export type CreateAgentResponse = AgentEntity

export interface UpdateAgentRequest extends Partial<AgentBase> {}

export type ReplaceAgentRequest = AgentBase

export const GetAgentResponseSchema = AgentEntitySchema.extend({
  tools: z.array(ToolSchema).optional(), // All tools available to the agent (including built-in and custom)
  installed_plugins: z.array(InstalledPluginSchema).optional() // Plugins loaded from .claude/plugins.json cache
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

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

export interface UpdateSessionRequest extends Partial<AgentBase> {}

export const GetAgentSessionResponseSchema = AgentSessionEntitySchema.extend({
  tools: z.array(ToolSchema).optional(), // All tools available to the session (including built-in and custom)
  messages: z.array(AgentSessionMessageEntitySchema).optional(), // Messages in the session
  plugins: z
    .array(
      z.object({
        filename: z.string(),
        type: z.enum(['agent', 'command', 'skill']),
        metadata: PluginMetadataSchema
      })
    )
    .optional() // Installed plugins from workdir
})

export const CreateAgentSessionResponseSchema = GetAgentSessionResponseSchema

export type GetAgentSessionResponse = z.infer<typeof GetAgentSessionResponseSchema>

export type CreateAgentSessionResponse = GetAgentSessionResponse

export const ListAgentSessionsResponseSchema = z.object({
  data: z.array(AgentSessionEntitySchema),
  total: z.int(),
  limit: z.int(),
  offset: z.int()
})

export type ListAgentSessionsResponse = z.infer<typeof ListAgentSessionsResponseSchema>

export type CreateSessionMessageRequest = z.infer<typeof CreateSessionMessageRequestSchema>

export type UpdateSessionResponse = GetAgentSessionResponse

export const AgentServerErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string()
  })
})

export type AgentServerError = z.infer<typeof AgentServerErrorSchema>

// ------------------ Task API types ------------------
export const CreateTaskRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  schedule_type: TaskScheduleTypeSchema,
  schedule_value: z.string().min(1, 'Schedule value is required'),
  context_mode: TaskContextModeSchema.optional().default('session')
})

export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>

export const UpdateTaskRequestSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  schedule_type: TaskScheduleTypeSchema.optional(),
  schedule_value: z.string().min(1).optional(),
  context_mode: TaskContextModeSchema.optional(),
  status: TaskStatusSchema.optional()
})

export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>

export const ListTasksResponseSchema = z.object({
  data: z.array(ScheduledTaskEntitySchema),
  total: z.int(),
  limit: z.int(),
  offset: z.int()
})

export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>

export const ListTaskLogsResponseSchema = z.object({
  data: z.array(TaskRunLogEntitySchema),
  total: z.int(),
  limit: z.int(),
  offset: z.int()
})

export type ListTaskLogsResponse = z.infer<typeof ListTaskLogsResponseSchema>

export const TaskIdParamSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required')
})

// ------------------ API validation schemas ------------------

// Parameter validation schemas
export const AgentIdParamSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required')
})

export const SessionIdParamSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required')
})

export const SessionMessageIdParamSchema = z.object({
  messageId: z.coerce.number().int().positive('Message ID must be a positive integer')
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

const AgentEffortSchema = z.enum(['low', 'medium', 'high', 'max'])

const AgentThinkingConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enabled'), budgetTokens: z.number().optional() }),
  z.object({ type: z.literal('disabled') }),
  z.object({ type: z.literal('adaptive') })
])

export type AgentEffort = z.infer<typeof AgentEffortSchema>
export type AgentThinkingConfig = z.infer<typeof AgentThinkingConfigSchema>

export const CreateSessionMessageRequestSchema = z.object({
  content: z.string().min(1, 'Content must be a valid string'),
  effort: AgentEffortSchema.optional(),
  thinking: AgentThinkingConfigSchema.optional()
})

export type PermissionModeCard = {
  mode: PermissionMode
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
  caution?: boolean
  unsupported?: boolean
}
