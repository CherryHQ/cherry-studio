/**
 * Database entity types for Agent, Session, and SessionMessage
 * Shared between main and renderer processes
 *
 * WARNING: Any null value will be converted to undefined from api.
 */
import { type AgentConfiguration, AgentConfigurationSchema } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ModelMessage } from 'ai'
import * as z from 'zod'

import type { MessageBlock } from './newMessage'

// ------------------ Core enums and helper types ------------------
export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

type SessionMessageRole = ModelMessage['role']

const sessionMessageRoles = ['assistant', 'user', 'system', 'tool'] as const satisfies readonly [
  SessionMessageRole,
  ...SessionMessageRole[]
]

const SessionMessageRoleSchema = z.enum(sessionMessageRoles)

export const AgentTypeSchema = z.enum(['claude-code'])
export type AgentType = z.infer<typeof AgentTypeSchema>

// ------------------ CherryClaw-specific types ------------------
export type FeishuDomain = 'feishu' | 'lark'
export type FeishuChannelConfig = {
  type: 'feishu'
  app_id: string
  app_secret: string
  encrypt_key: string
  verification_token: string
  allowed_chat_ids: string[]
  domain: FeishuDomain
}

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
export { type AgentConfiguration, AgentConfigurationSchema }

// ------------------ Scheduled Task types ------------------
const TaskScheduleTypeSchema = z.enum(['cron', 'interval', 'once'])
export type TaskScheduleType = z.infer<typeof TaskScheduleTypeSchema>

const TaskStatusSchema = z.enum(['active', 'paused', 'completed'])

export const ScheduledTaskEntitySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  name: z.string(),
  prompt: z.string(),
  scheduleType: TaskScheduleTypeSchema,
  scheduleValue: z.string(),
  timeoutMinutes: z.number(),
  channelIds: z.array(z.string()).optional(),
  nextRun: z.string().nullable().optional(),
  lastRun: z.string().nullable().optional(),
  lastResult: z.string().nullable().optional(),
  status: TaskStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export type ScheduledTaskEntity = z.infer<typeof ScheduledTaskEntitySchema>

export const TaskRunLogEntitySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sessionId: z.string().nullable().optional(),
  runAt: z.string(),
  durationMs: z.number(),
  status: z.enum(['running', 'success', 'error']),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional()
})

export type TaskRunLogEntity = z.infer<typeof TaskRunLogEntitySchema>

// Shared configuration interface for both agents and sessions
export const AgentBaseSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  accessiblePaths: z.array(z.string()),
  instructions: z.string().optional(),
  model: z.string(),
  planModel: z.string().optional(),
  smallModel: z.string().optional(),
  mcps: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  configuration: AgentConfigurationSchema.optional()
})

export type AgentBase = z.infer<typeof AgentBaseSchema>

export type AgentBaseWithId = Omit<AgentBase, 'model'> & { id: string; model?: string }

// ------------------ Persistence entities ------------------

// Agent entity. `model` is optional because the DB FK is ON DELETE SET NULL.
export const AgentEntitySchema = AgentBaseSchema.extend({
  id: z.string(),
  type: AgentTypeSchema,
  model: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export type AgentEntity = z.infer<typeof AgentEntitySchema>

export const isAgentEntity = (value: unknown): value is AgentEntity => {
  return AgentEntitySchema.safeParse(value).success
}

export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'orderKey'
  orderBy?: 'asc' | 'desc'
}

// AgentSessionMessageEntity representing a message within a session
export const AgentSessionMessageEntitySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: SessionMessageRoleSchema,
  content: z.unknown(),
  agentSessionId: z.string().nullable(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export type AgentSessionMessageEntity = z.infer<typeof AgentSessionMessageEntitySchema>

/**
 * V2 persisted message format for agent sessions.
 * After blocks→parts migration, `blocks` is empty and content is in `message.data.parts`.
 *
 * @deprecated Legacy `message.blocks: string[]` and top-level `blocks: MessageBlock[]` are
 * retained for backward compatibility with un-migrated data. New writes should use `data.parts`.
 */
export interface AgentPersistedMessage {
  message: AgentPersistedMessageContent
  /** @deprecated Empty after blocks→parts migration. */
  blocks: MessageBlock[]
}

/** Message content stored in agent session_messages. Compatible with both old (blocks) and new (parts) formats. */
export interface AgentPersistedMessageContent {
  id: string
  role: string
  assistantId?: string
  topicId?: string
  createdAt?: string
  status?: string
  /** @deprecated Use data.parts for new messages. */
  blocks?: string[]
  /** V2 message data with parts. */
  data?: { parts?: CherryMessagePart[] }
  [key: string]: unknown
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

// ------------------ Form models ------------------
export type BaseAgentForm = {
  id?: string
  type: AgentType
  name: string
  description?: string
  instructions?: string
  model: string
  accessiblePaths: string[]
  allowedTools: string[]
  mcps?: string[]
  configuration?: AgentConfiguration
}

export type AddAgentForm = Omit<BaseAgentForm, 'id'> & { id?: never }

export type UpdateAgentForm = Partial<Omit<BaseAgentForm, 'type'>> & {
  id: string
  type?: never
}

/**
 * Session forms only carry instance-level fields. Config (model, instructions,
 * etc.) belongs to the parent agent and is updated via UpdateAgentForm.
 */
export type CreateSessionForm = {
  agentId: string
  name: string
  description?: string
  id?: never
}

export type UpdateSessionForm = { id: string; name?: string; description?: string }

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
export type CreateAgentResponse = AgentEntity

export type GetAgentResponse = AgentEntity & { tools?: Tool[] }

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
  scheduleType: TaskScheduleTypeSchema,
  scheduleValue: z.string().min(1, 'Schedule value is required'),
  timeoutMinutes: z.number().min(1).nullable().optional(),
  channelIds: z.array(z.string()).optional()
})

export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>

export const UpdateTaskRequestSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  scheduleType: TaskScheduleTypeSchema.optional(),
  scheduleValue: z.string().min(1).optional(),
  timeoutMinutes: z.number().min(1).nullable().optional(),
  channelIds: z.array(z.string()).optional(),
  status: TaskStatusSchema.optional()
})

export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>

export type PermissionModeCard = {
  mode: PermissionMode
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
  caution?: boolean
  unsupported?: boolean
}
