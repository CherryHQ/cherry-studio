import type { Tool } from '@shared/ai/tool'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentType, InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Prompt } from '@shared/data/types/prompt'
import type { SkillCatalogEntry } from '@shared/types/skill'

export type ResourceType = 'agent' | 'assistant' | 'skill' | 'prompt'

export type ResourceEditDialogTarget = ({ kind: 'assistant'; id: string } | { kind: 'agent'; id: string }) & {
  /** Leaf tab id to open the dialog on (e.g. `tools.mcp`, `tools.skills`). */
  initialTab?: string
  /** Agent profile only: the Agent was just created and its automatic setup did not fully succeed. */
  setupIncomplete?: boolean
}

/** Validated values shared by every Assistant / Agent creation entry point. */
export type ResourceCreateValues = {
  agentType: AgentType
  permissionMode: AgentPermissionMode
  avatar: string
  name: string
  modelId: UniqueModelId
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  skillIds: string[]
  /** Set by "Agent create" when the prompt fell back to the user's input or a recommended skill failed to install. */
  setupIncomplete?: boolean
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
