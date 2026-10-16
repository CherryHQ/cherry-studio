import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'

export type MarketplaceResourceType = 'skill' | 'agent' | 'assistant' | 'mcp'
export type MarketplaceView = 'all' | MarketplaceResourceType

export interface AgentCatalogPreset {
  id: string
  name: { en: string; zh: string }
  description: { en: string; zh: string }
  avatar: string
  category: string
  instructions: string
}

export type MarketplaceTemplate = {
  id: string
  name: string
  description: string
  avatar: string
  prompt: string
  groups: string[]
} & ({ kind: 'agent' } | { kind: 'assistant'; createDto: CreateAssistantDto })
