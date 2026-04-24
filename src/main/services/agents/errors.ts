import type { AgentType } from '@types'

export type AgentModelField = 'model' | 'planModel' | 'smallModel'

export interface ModelValidationError {
  type: string
  message: string
  code: string
}

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
