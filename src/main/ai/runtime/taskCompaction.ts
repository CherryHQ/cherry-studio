import { application } from '@application'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { clampThresholdPercent } from '@shared/utils/contextSettings'

export function taskCompactionPercent(session: AgentSessionEntity & { isTaskReuseTarget?: boolean }) {
  if (!session.isTaskReuseTarget) return undefined
  return clampThresholdPercent(
    application.get('PreferenceService').get('chat.context_settings.compress.threshold_percent')
  )
}
