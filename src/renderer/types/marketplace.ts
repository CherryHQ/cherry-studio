export type MarketplaceResourceType = 'skill' | 'agent' | 'mcp'
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
}
