import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Assistant } from '@shared/data/types/assistant'
import type { EntityAvatarIntent } from '@shared/ipc/schemas/entityImage'

import { withCreatedImageEntry } from './entityImageBinding'

export function setAssistantAvatar(assistantId: string, avatar: EntityAvatarIntent): Promise<Assistant> | Assistant {
  return avatar.kind === 'image'
    ? withCreatedImageEntry(avatar.data, (fileId) => assistantDataService.setAvatarImage(assistantId, fileId))
    : assistantDataService.setAvatarEmoji(assistantId, avatar.emoji)
}

export function setAgentAvatar(agentId: string, avatar: EntityAvatarIntent): Promise<AgentEntity> | AgentEntity {
  return avatar.kind === 'image'
    ? withCreatedImageEntry(avatar.data, (fileId) => agentService.setAvatarImage(agentId, fileId))
    : agentService.setAvatarEmoji(agentId, avatar.emoji)
}
