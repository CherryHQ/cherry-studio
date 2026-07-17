import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Assistant } from '@shared/data/types/assistant'
import type { EntityAvatarIntent } from '@shared/ipc/schemas/entityImage'
import { useCallback } from 'react'

const ASSISTANT_AVATAR_CACHE_KEYS = ['/assistants', '/assistants/*', '/search/entities'] as const
const AGENT_AVATAR_CACHE_KEYS = ['/agents', '/agents/*', '/search/entities'] as const

export type EntityAvatarIntentInput =
  | { kind: 'image'; data: Uint8Array<ArrayBufferLike> }
  | { kind: 'emoji'; emoji: string }

function cloneImageData(avatar: EntityAvatarIntentInput): EntityAvatarIntent {
  return avatar.kind === 'image' ? { kind: 'image', data: Uint8Array.from(avatar.data) } : avatar
}

export function useEntityAvatar() {
  const invalidate = useInvalidateCache()

  const setAssistantAvatar = useCallback(
    async (assistantId: string, avatar: EntityAvatarIntentInput): Promise<Assistant> => {
      const updated = await ipcApi.request('assistant.set_avatar', { assistantId, avatar: cloneImageData(avatar) })
      await invalidate([...ASSISTANT_AVATAR_CACHE_KEYS])
      return updated
    },
    [invalidate]
  )

  const setAgentAvatar = useCallback(
    async (agentId: string, avatar: EntityAvatarIntentInput): Promise<AgentEntity> => {
      const updated = await ipcApi.request('agent.set_avatar', { agentId, avatar: cloneImageData(avatar) })
      await invalidate([...AGENT_AVATAR_CACHE_KEYS])
      return updated
    },
    [invalidate]
  )

  return { setAgentAvatar, setAssistantAvatar }
}
