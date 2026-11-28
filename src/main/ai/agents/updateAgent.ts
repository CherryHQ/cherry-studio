import { agentService } from '@data/services/AgentService'
import { trackAgentSettingChanges, trackMainProductEvent } from '@main/services/productAnalytics'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentEntity, UpdateAgentDto } from '@shared/data/api/schemas/agents'

/** A user's Agent edit: persists it, then reports which settings and skills changed. */
export function updateAgent(agentId: string, updates: UpdateAgentDto): AgentEntity {
  const before = agentService.getAgent(agentId)
  const agent = agentService.updateAgent(agentId, updates)
  if (!agent) throw DataApiErrorFactory.notFound('Agent', agentId)
  try {
    if (before) trackAgentSettingChanges(before, agent, updates)
    for (const update of updates.skillUpdates ?? []) {
      trackMainProductEvent({
        event: 'feature_used',
        feature: 'skills',
        action: update.isEnabled ? 'skill_enabled' : 'skill_disabled',
        origin: 'ui'
      })
    }
  } catch {
    // Analytics never affects the saved edit.
  }
  return agent
}
