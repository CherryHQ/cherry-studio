import { loggerService } from '@logger'
import { type AgentConfiguration, AgentConfigurationSchema } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('agentConfiguration')

export function parseAgentConfiguration(
  raw: Record<string, unknown> | null | undefined,
  context: { entityId: string; entityType: 'agent' | 'session' }
): AgentConfiguration | undefined {
  if (raw == null) return undefined

  const parsed = AgentConfigurationSchema.safeParse(raw)
  if (parsed.success) {
    return parsed.data
  }

  logger.warn('Agent configuration drift detected', {
    ...context,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
  })

  return raw as AgentConfiguration
}
