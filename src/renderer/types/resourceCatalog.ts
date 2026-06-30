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
  tags: string[]
  createdAt: string
  updatedAt: string
  raw: TRaw
}

export type ResourceItem =
  | ResourceItemBase<'assistant', Assistant>
  | ResourceItemBase<'agent', AgentDetail>
  | ResourceItemBase<'skill', InstalledSkill>
  | ResourceItemBase<'prompt', Prompt>

export interface TagItem {
  id: string
  name: string
  color: string
  count: number
}

export type LibrarySidebarFilter = { resourceType: ResourceType }

export interface ResourceTypeUIConfig {
  icon: React.ElementType
  color: string
}
