import type { AgentType } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'

export type ResourceCreateWizardKind = 'assistant' | 'agent'

/**
 * Internal react-hook-form state for the stepped create wizard.
 *
 * Field names are deliberately aligned with the shared edit-dialog field
 * components (`avatar`, `name`, `description`, `modelId`) so those components
 * can be reused as-is. The remaining fields are the per-kind step payloads:
 * `knowledgeBaseIds` (assistant) and `skillIds` (agent). Steps not shown for
 * a given kind keep their default empty value.
 */
export type ResourceCreateWizardFormValues = {
  avatar: string
  name: string
  description: string
  /** Agent runtime driver. Ignored for the assistant kind. */
  agentType: AgentType
  modelId: UniqueModelId | null
  /** Renderer-only connection entry; PAT is sent once through IpcApi and never persisted here. */
  stellaEndpoint: string
  stellaPat: string
  stellaRemoteAgentId: string
  prompt: string
  // assistant step 3
  knowledgeBaseIds: string[]
  // agent step 3
  skillIds: string[]
}

/**
 * Validated submit payload handed to the caller's `onSubmit`. `modelId` is
 * present for local runtimes; Stella stores a remote-agent reference instead.
 */
export type ResourceCreateWizardValues = {
  avatar: string
  name: string
  /** Agent runtime driver (agent kind only; assistant callers ignore it). */
  agentType: AgentType
  modelId: UniqueModelId | null
  stellaRemoteAgentId?: string
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  skillIds: string[]
}
