import type { AgentCreateValues } from '@shared/ai/agentCreateCommand'
import type { Tool } from '@shared/ai/tool'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import type { SkillCatalogEntry } from '@shared/types/skill'

export type ResourceType = 'agent' | 'assistant' | 'skill' | 'prompt'

export type ResourceEditDialogTarget = ({ kind: 'assistant'; id: string } | { kind: 'agent'; id: string }) & {
  /** Deep-link ID naming the page to open (e.g. `tools.mcp`, `memory`, `channels`); see `resolveInitialEditPage`. */
  initialTab?: string
}

/** Validated values shared by every Assistant / Agent creation entry point. */
export type ResourceCreateValues = AgentCreateValues & {
  /** Assistant-only web search switch, set by auto create. */
  enableWebSearch?: boolean
}

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
  avatarSrc?: string
  model?: string
  createdAt: string
  updatedAt: string
  raw: TRaw
}

export type ResourceItem =
  | (ResourceItemBase<'assistant', Assistant> & { groupId?: string; groupName?: string })
  | (ResourceItemBase<'agent', AgentDetail> & { groupId?: never; groupName?: never })
  | (ResourceItemBase<'skill', InstalledSkill & Partial<Pick<SkillCatalogEntry, 'scope'>>> & {
      groupId?: never
      groupName?: never
    })
  | (ResourceItemBase<'prompt', Prompt> & { groupId?: never; groupName?: never })

export interface GroupItem {
  id: string
  name: string
  count: number
}

export interface ResourceTypeUIConfig {
  icon: React.ElementType
  color: string
}
