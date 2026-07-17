import type { Tool } from '@shared/ai/tool'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { EntityAvatar } from '@shared/data/types/entityAvatar'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Prompt } from '@shared/data/types/prompt'

export type ResourceType = 'agent' | 'assistant' | 'skill' | 'prompt'

/** Validated values shared by every Assistant / Agent creation entry point. */
export type ResourceCreateValues = {
  avatar: string
  avatarImageData?: Uint8Array
  name: string
  modelId: UniqueModelId
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  skillIds: string[]
}

export type SortKey = 'updatedAt' | 'createdAt' | 'name'

export type AgentDetail = AgentEntity & {
  tools?: Tool[]
}

interface ResourceItemBase<TType extends ResourceType, TRaw, TAvatar> {
  id: string
  type: TType
  name: string
  description: string
  avatar: TAvatar
  model?: string
  createdAt: string
  updatedAt: string
  raw: TRaw
}

export type ResourceItem =
  | (ResourceItemBase<'assistant', Assistant, EntityAvatar> & { tag?: string })
  | (ResourceItemBase<'agent', AgentDetail, EntityAvatar> & { tag?: never })
  | (ResourceItemBase<'skill', InstalledSkill, string> & { tag?: never })
  | (ResourceItemBase<'prompt', Prompt, string> & { tag?: never })

export interface TagItem {
  id: string
  name: string
  color: string
  count: number
}

export interface ResourceTypeUIConfig {
  icon: React.ElementType
  color: string
}
