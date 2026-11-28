import type { BuiltinAgentRole } from '@shared/ai/builtinAgent'
import {
  type AgentConfiguration,
  type AgentType,
  AgentTypeSchema,
  sanitizeAgentConfiguration
} from '@shared/data/api/schemas/agents'

export interface BuiltinAgentDefaults {
  name: string
  type: AgentType
  configuration: AgentConfiguration
  disabledTools?: readonly string[]
}

export function parseBuiltinAgentDefaults(
  role: BuiltinAgentRole,
  definition: { name?: string; type?: unknown; configuration?: unknown; disabledTools?: readonly string[] }
): BuiltinAgentDefaults {
  const { data: configuration, invalidKeys } = sanitizeAgentConfiguration(definition.configuration)
  if (!configuration || invalidKeys.length > 0) {
    throw new Error(`Builtin Agent package configuration is invalid for ${role}: ${invalidKeys.join(', ') || '<root>'}`)
  }

  const type = AgentTypeSchema.safeParse(definition.type)
  if (!type.success) {
    throw new Error(`Builtin Agent package type is invalid for ${role}`)
  }

  return {
    name: definition.name?.trim() || 'Built-in Agent',
    type: type.data,
    configuration: { ...configuration, builtin_role: role },
    ...(definition.disabledTools ? { disabledTools: definition.disabledTools } : {})
  }
}
