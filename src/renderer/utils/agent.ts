import type { PermissionModeCard } from '@renderer/types/agent'
import type { AgentConfiguration } from '@shared/data/types/agent'
import type { ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { TFunction } from 'i18next'

export const DEFAULT_AGENT_AVATAR = '🤖'

export function getAgentAvatar(avatar?: unknown) {
  return typeof avatar === 'string' ? avatar.trim() || DEFAULT_AGENT_AVATAR : DEFAULT_AGENT_AVATAR
}

export function getAgentAvatarFromConfiguration(configuration?: Pick<AgentConfiguration, 'avatar'> | null) {
  return getAgentAvatar(configuration?.avatar)
}

export function getAgentDescriptionForDisplay(
  agent: { description?: string | null; configuration?: AgentConfiguration | null },
  t: TFunction
): string {
  if (agent.description) return agent.description
  // Builtin contract: an empty DB description means the bundle/UI owns the localized
  // default. A non-empty user edit is user-owned and is never overwritten.
  if (agent.configuration?.builtin_role === 'assistant') {
    return t('agent.builtin.cherry_assistant.description')
  }
  return ''
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
    titleFallback: 'Ask Before Acting',
    descriptionKey: 'agent.settings.tooling.permissionMode.default.description',
    descriptionFallback: 'Asks before editing files or running commands.'
  },
  {
    mode: 'plan',
    // t('agent.settings.tooling.permissionMode.plan.title')
    titleKey: 'agent.settings.tooling.permissionMode.plan.title',
    titleFallback: 'Plan Only',
    descriptionKey: 'agent.settings.tooling.permissionMode.plan.description',
    descriptionFallback: 'Plans without editing files. Only read-only or vetted commands run.'
  },
  {
    mode: 'acceptEdits',
    // t('agent.settings.tooling.permissionMode.acceptEdits.title')
    titleKey: 'agent.settings.tooling.permissionMode.acceptEdits.title',
    titleFallback: 'Auto-accept Edits',
    descriptionKey: 'agent.settings.tooling.permissionMode.acceptEdits.description',
    descriptionFallback: 'Edits files freely. Asks before commands.'
  },
  {
    mode: 'auto',
    // t('agent.settings.tooling.permissionMode.auto.title')
    titleKey: 'agent.settings.tooling.permissionMode.auto.title',
    titleFallback: 'Approve for Me',
    descriptionKey: 'agent.settings.tooling.permissionMode.auto.description',
    descriptionFallback: 'Runs without routine prompts. A safety check blocks risky actions.'
  },
  {
    mode: 'bypassPermissions',
    // t('agent.settings.tooling.permissionMode.bypassPermissions.title')
    titleKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title',
    titleFallback: 'Full Access',
    descriptionKey: 'agent.settings.tooling.permissionMode.bypassPermissions.description',
    descriptionFallback: 'Skips permission checks. Can delete files and use the network.',
    dangerous: true
  }
]
