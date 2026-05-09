/**
 * Renderer-only agent UI / form types.
 *
 * Entity & API DTO types live in `@shared/data/api/schemas/agents` and
 * `@shared/data/types/agent` — import them from there directly. This file
 * intentionally does not re-export them.
 */
import { AgentBaseSchema, type AgentConfiguration, AgentEntitySchema } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentBase, AgentEntity, AgentTool, AgentType } from '@shared/data/types/agent'
import * as z from 'zod'

// ------------------ Permission mode (renderer-side mirror of the
//                    `claude-agent-sdk` enum, used by UI cards/forms) ------
export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

export type PermissionModeCard = {
  mode: PermissionMode
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
  caution?: boolean
  unsupported?: boolean
}

// ------------------ Channel config (Feishu) ------------------
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

// ------------------ Type guards ------------------
export const isAgentType = (type: unknown): type is AgentType => {
  // Mirror the shared `AgentType = 'claude-code'` literal — kept inline so the
  // guard stays a pure runtime check without dragging the zod schema in.
  return type === 'claude-code'
}

export const isAgentEntity = (value: unknown): value is AgentEntity => {
  return AgentEntitySchema.safeParse(value).success
}

// ------------------ Form models (UI-only) --------------------------------
export type AgentBaseWithId = Omit<AgentBase, 'model'> & { id: string; model?: string }

export type BaseAgentForm = {
  id?: string
  type: AgentType
  name: string
  description?: string
  instructions?: string
  model: string
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
 * Session forms carry instance-level fields plus the workspace binding
 * (`accessiblePaths`). Workspace is set at create time only — `UpdateSessionForm`
 * deliberately excludes it so a running session can't be re-pointed.
 */
export type CreateSessionForm = {
  agentId: string
  name: string
  description?: string
  accessiblePaths?: string[]
  id?: never
}

export type UpdateSessionForm = { id: string; name?: string; description?: string }

export type UpdateAgentBaseForm = Partial<AgentBase> & { id: string }

// ------------------ Hook signatures --------------------------------------
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

// ------------------ Renderer-side DTO aliases ----------------------------
export type GetAgentResponse = AgentEntity & { tools?: AgentTool[] }

// ------------------ Form-only effort / thinking discriminators -----------
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AgentThinkingConfig =
  | { type: 'enabled'; budgetTokens?: number }
  | { type: 'disabled' }
  | { type: 'adaptive'; display?: 'omitted' | 'summarized' }

// ------------------ Server error envelope (parsed in utils/error.ts) -----
export const AgentServerErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string()
  })
})

export type AgentServerError = z.infer<typeof AgentServerErrorSchema>

// AgentBaseSchema kept available for renderer forms that build on it (e.g.
// AgentSettings/components/* spread it to derive partial validation). Not
// re-defined; sourced from shared.
export { AgentBaseSchema }
