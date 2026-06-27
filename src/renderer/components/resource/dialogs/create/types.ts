import type { UniqueModelId } from '@shared/data/types/model'

export type ResourceCreateWizardKind = 'assistant' | 'agent'

/**
 * Internal react-hook-form state for the stepped create wizard.
 *
 * Field names are deliberately aligned with the shared edit-dialog field
 * components (`avatar`, `name`, `description`, `modelId`) so those components
 * can be reused as-is. The remaining fields are the per-kind step payloads:
 * `knowledgeBaseIds` (assistant) and `mcps` / `disabledTools` / `skillIds`
 * (agent). Steps not shown for a given kind keep their default empty value.
 */
export type ResourceCreateWizardFormValues = {
  avatar: string
  name: string
  description: string
  modelId: UniqueModelId | null
  prompt: string
  // assistant step 3
  knowledgeBaseIds: string[]
  // agent step 3
  mcps: string[]
  /** Opt-out list of disabled builtin tool keys (empty = all enabled). */
  disabledTools: string[]
  skillIds: string[]
}

/**
 * Validated submit payload handed to the caller's `onSubmit`. `modelId` is
 * guaranteed non-null (basic-step validation gates submission).
 */
export type ResourceCreateWizardValues = {
  avatar: string
  name: string
  modelId: UniqueModelId
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  mcps: string[]
  disabledTools: string[]
  skillIds: string[]
}
