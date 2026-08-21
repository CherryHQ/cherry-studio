import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Assistant } from '@shared/data/types/assistant'
import type { SetAvatarIntent } from '@shared/ipc/schemas/avatar'

import { withUploadedIconEntry } from './uploadedIcon'

export function setAssistantAvatar(assistantId: string, avatar: SetAvatarIntent): Promise<Assistant> | Assistant {
  return avatar.kind === 'image'
    ? withUploadedIconEntry(avatar.data, 'delete_when_unreferenced', (fileId) =>
        assistantDataService.setAvatarImage(assistantId, fileId)
      )
    : assistantDataService.setAvatarEmoji(assistantId, avatar.emoji)
}

export function setAgentAvatar(agentId: string, avatar: SetAvatarIntent): Promise<AgentEntity> | AgentEntity {
  return avatar.kind === 'image'
    ? withUploadedIconEntry(avatar.data, 'delete_when_unreferenced', (fileId) =>
        agentService.setAvatarImage(agentId, fileId)
      )
    : agentService.setAvatarEmoji(agentId, avatar.emoji)
}
