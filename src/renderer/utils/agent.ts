import type { PermissionModeCard } from '@renderer/types/agent'
import type { AgentConfiguration, AgentType } from '@shared/data/types/agent'
import type { ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

export const DEFAULT_AGENT_AVATAR = '🤖'

export function getAgentAvatar(avatar?: unknown) {
  return typeof avatar === 'string' ? avatar.trim() || DEFAULT_AGENT_AVATAR : DEFAULT_AGENT_AVATAR
}

export function getAgentAvatarFromConfiguration(configuration?: Pick<AgentConfiguration, 'avatar'> | null) {
  return getAgentAvatar(configuration?.avatar)
}

export function getAgentModelFallbackSnapshot(agent?: {
  model?: string | null
  modelName?: string | null
}): ModelSnapshot | undefined {
  const modelString = agent?.model
  if (!isUniqueModelId(modelString)) return undefined

  const { providerId, modelId } = parseUniqueModelId(modelString)
  if (!providerId || !modelId) return undefined

  return { id: modelId, name: agent?.modelName ?? modelId, provider: providerId }
}

export const permissionModeCards: PermissionModeCard[] = [
  {
    mode: 'default',
    // t('agent.settings.tooling.permissionMode.default.title')
    titleKey: 'agent.settings.tooling.permissionMode.default.title',
    titleFallback: 'Normal Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.default.description',
    descriptionFallback: 'Can read files freely. Asks before editing or running commands.'
  },
  {
    mode: 'plan',
    // t('agent.settings.tooling.permissionMode.plan.title')
    titleKey: 'agent.settings.tooling.permissionMode.plan.title',
    titleFallback: 'Plan Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.plan.description',
    descriptionFallback: 'Can only read files and make plans. Cannot edit files or run commands.'
  },
  {
    mode: 'acceptEdits',
    // t('agent.settings.tooling.permissionMode.acceptEdits.title')
    titleKey: 'agent.settings.tooling.permissionMode.acceptEdits.title',
    titleFallback: 'Auto-edit Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.acceptEdits.description',
    descriptionFallback: 'Can read and edit files freely. Asks before running commands.'
  },
  {
    mode: 'bypassPermissions',
    // t('agent.settings.tooling.permissionMode.bypassPermissions.title')
    titleKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title',
    titleFallback: 'Full Auto Mode',
    descriptionKey: 'agent.settings.tooling.permissionMode.bypassPermissions.description',
    descriptionFallback: 'Can do everything without asking. Use with caution.',
    caution: true
  }
]

/**
 * Permission-mode cards offered for an agent type. `pi` has no plan mode
 * (deferred — see plan D8), so it drops the `plan` card; every other type
 * keeps the full set.
 */
export function getPermissionModeCards(agentType: AgentType | string | undefined): PermissionModeCard[] {
  if (agentType === 'pi') return permissionModeCards.filter((card) => card.mode !== 'plan')
  return permissionModeCards
}
