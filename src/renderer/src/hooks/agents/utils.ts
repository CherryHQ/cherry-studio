import { loggerService } from '@logger'
import { type AgentConfiguration, sanitizeAgentConfiguration } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('agentConfiguration')

export function parseAgentConfiguration(
  raw: Record<string, unknown> | null | undefined,
  context: { entityId: string; entityType: 'agent' | 'session' }
): AgentConfiguration | undefined {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (invalidKeys.length > 0) {
    logger.warn('Agent configuration drift detected; dropping invalid keys', { ...context, invalidKeys })
  }
  return data
}
