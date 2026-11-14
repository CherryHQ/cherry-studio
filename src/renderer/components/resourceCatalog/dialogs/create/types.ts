import type { ChannelDraftItem } from '@renderer/components/channel/channelDraft'
import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import type { AgentCreateSettings } from '@shared/ai/agentForm'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentType } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'

export type ResourceCreateWizardKind = 'assistant' | 'agent'

/** An uploaded avatar held until the resource exists; the wizard saves it right after create. */
export type AvatarImageDraft = {
  /** Prepared by `prepareAvatarImage`, ready for `*.set_avatar`. */
  data: Uint8Array<ArrayBuffer>
  previewUrl: string
}

/**
 * Internal react-hook-form state for the stepped create wizard.
 *
 * Field names are deliberately aligned with the shared edit-dialog field
 * components (`avatar`, `name`, `description`, `modelId`) so those components
 * can be reused as-is. `knowledgeBaseIds` is shared by both kinds, while
 * `skillIds` is set by the Agent capability step or by auto create.
 */
export type ResourceCreateWizardFormValues = {
  avatar: string
  /** Shown instead of `avatar` while set; the emoji stays the fallback. */
  avatarImage: AvatarImageDraft | null
  name: string
  description: string
  /** Agent runtime driver. Ignored for the assistant kind. */
  agentType: AgentType
  /** Agent permission policy. Ignored for the assistant kind. */
  permissionMode: AgentPermissionMode
  modelId: UniqueModelId | null
  prompt: string
  // assistant step 3 / agent step 4
  knowledgeBaseIds: string[]
  // agent step 3
  skillIds: string[]
  // agent MCP step, or auto create
  mcpServerIds: string[]
  // set only by auto create
  enableWebSearch: boolean
  // agent tools step
  disabledTools: string[]
  // agent channels step
  channels: ChannelDraftItem[]
  // agent advanced step: reply language, heartbeat, env vars
} & AgentCreateSettings

/**
 * Validated submit payload handed to the caller's `onSubmit`. `modelId` is
 * guaranteed non-null (both the basic step and the entry view require a model).
 */
export type ResourceCreateWizardValues = ResourceCreateValues & {
  /** Agent runtime driver. Assistant callers ignore it. */
  agentType: AgentType
  /** Agent permission policy. Assistant callers ignore it. */
  permissionMode: AgentPermissionMode
}
