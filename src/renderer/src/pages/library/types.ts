import type { Tag } from '@shared/data/types/tag'

export type ResourceType = 'agent' | 'assistant' | 'skill'

export type SortKey = 'updatedAt' | 'createdAt' | 'name'

export interface ResourceItem {
  id: string
  type: ResourceType
  name: string
  description: string
  avatar: string
  model?: string
  version?: string
  tags: string[]
  tagRefs: Tag[]
  enabled: boolean
  hasUpdate?: boolean
  author?: string
  source?: string
  createdAt: string
  updatedAt: string
  raw: unknown
  pendingBackend?: boolean
}

export interface TagItem {
  id: string
  name: string
  color: string
  count: number
}

export type LibrarySidebarFilter = { type: 'resource'; resourceType: ResourceType } | { type: 'tag'; tagName: string }

export interface ResourceTypeUIConfig {
  icon: React.ElementType
  color: string
}
