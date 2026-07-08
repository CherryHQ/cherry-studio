import type { Tool } from '@shared/ai/tool'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'

export type ResourceType = 'agent' | 'assistant' | 'skill' | 'prompt'

export type SortKey = 'updatedAt' | 'createdAt' | 'name'

export type AgentDetail = AgentEntity & {
  tools?: Tool[]
}

interface ResourceItemBase<TType extends ResourceType, TRaw> {
  id: string
  type: TType
  name: string
  description: string
  avatar: string
  model?: string
  createdAt: string
  updatedAt: string
  raw: TRaw
}

export type ResourceItem =
  | (ResourceItemBase<'assistant', Assistant> & { tag?: string })
  | (ResourceItemBase<'agent', AgentDetail> & { tag?: never })
  | (ResourceItemBase<'skill', InstalledSkill> & { tag?: never })
  | (ResourceItemBase<'prompt', Prompt> & { tag?: never })

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
