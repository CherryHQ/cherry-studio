import type { ModelValidationError } from '@main/apiServer/utils'
import type { AgentType } from '@types'

export type AgentModelField = 'model' | 'plan_model' | 'small_model'

export interface AgentModelValidationContext {
  agentType: AgentType
  field: AgentModelField
  model?: string
}

export class AgentModelValidationError extends Error {
  readonly context: AgentModelValidationContext
  readonly detail: ModelValidationError

  constructor(context: AgentModelValidationContext, detail: ModelValidationError) {
    super(`Validation failed for ${context.agentType}.${context.field}: ${detail.message}`)
    this.name = 'AgentModelValidationError'
    this.context = context
    this.detail = detail
  }
}
