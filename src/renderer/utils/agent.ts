import type { AgentConfiguration } from '@shared/data/types/agent'

export const DEFAULT_AGENT_AVATAR = '🤖'

export function getAgentAvatar(avatar?: unknown) {
  return typeof avatar === 'string' ? avatar.trim() || DEFAULT_AGENT_AVATAR : DEFAULT_AGENT_AVATAR
}

export function getAgentAvatarFromConfiguration(configuration?: Pick<AgentConfiguration, 'avatar'> | null) {
  return getAgentAvatar(configuration?.avatar)
}
