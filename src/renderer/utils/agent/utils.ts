import { loggerService } from '@logger'
import { type AgentConfiguration, sanitizeAgentConfiguration } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('agentConfiguration')

export function parseAgentConfiguration(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored agent/session configuration is unvalidated; the shared sanitizer checks the root and known fields while preserving extension keys.
  raw: unknown,
  context: { entityId: string; entityType: 'agent' | 'session' }
): AgentConfiguration | undefined {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (invalidKeys.length > 0) {
    logger.warn('Agent configuration drift detected; dropping invalid keys', { ...context, invalidKeys })
  }
  return data
}
