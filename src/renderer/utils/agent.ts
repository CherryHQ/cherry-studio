import type { PermissionModeCard } from '@renderer/types/agent'
import type { AgentConfiguration } from '@shared/data/types/agent'

export const DEFAULT_AGENT_AVATAR = '🤖'

export function getAgentAvatar(avatar?: unknown) {
  return typeof avatar === 'string' ? avatar.trim() || DEFAULT_AGENT_AVATAR : DEFAULT_AGENT_AVATAR
}

export function getAgentAvatarFromConfiguration(configuration?: Pick<AgentConfiguration, 'avatar'> | null) {
  return getAgentAvatar(configuration?.avatar)
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
