export type ResourceType = 'agent' | 'assistant' | 'skill'

export type SortKey = 'updatedAt' | 'createdAt' | 'name'

export interface ResourceItem {
  id: string
  type: ResourceType
  name: string
  description: string
  avatar: string
  model?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  raw: unknown
}

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
