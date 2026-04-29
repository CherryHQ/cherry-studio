import { type AgentConfiguration, AgentConfigurationSchema } from '@shared/data/api/schemas/agents'

export function parseAgentConfiguration(
  raw: Record<string, unknown> | null | undefined
): AgentConfiguration | undefined {
  if (raw == null) return undefined
  return AgentConfigurationSchema.parse(raw)
}
