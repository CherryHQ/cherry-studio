import type { Tool } from '@shared/ai/tool'
import type { AgentChannelDraft } from '@shared/data/api/schemas/agentChannels'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentType, InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Prompt } from '@shared/data/types/prompt'
import type { SkillCatalogEntry } from '@shared/types/skill'

export type ResourceType = 'agent' | 'assistant' | 'skill' | 'prompt'

export type ResourceEditDialogTarget = ({ kind: 'assistant'; id: string } | { kind: 'agent'; id: string }) & {
  /** Deep-link ID naming the page to open (e.g. `tools.mcp`, `memory`, `channels`); see `resolveInitialEditPage`. */
  initialTab?: string
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
  mcpServerIds?: string[]
  /** Assistant-only web search switch, set by auto create. */
  enableWebSearch?: boolean
  /** Agent-only opt-out list of built-in tools (empty = all enabled). */
  disabledTools?: string[]
  /** Agent-only advanced settings. */
  agentSettings?: AgentCreateSettings
  /** Agent-only channels, created with the Agent. */
  channels?: AgentChannelDraft[]
}

/** Reply language, heartbeat and env vars in the Agent edit form's shape, so create saves what edit would. */
export type AgentCreateSettings = {
  languageMode: 'inherit' | 'off' | 'custom'
  languageCustom: string
  heartbeatEnabled: boolean
  heartbeatInterval: number
  heartbeatTimeoutMinutes: number
  /** One `KEY=VALUE` per line. */
  envVarsText: string
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
