import type { Tag } from '@shared/data/types/tag'
import { useCallback, useMemo } from 'react'

import { agentAdapter } from '../adapters/agentAdapter'
import { assistantAdapter } from '../adapters/assistantAdapter'
import { skillAdapter } from '../adapters/skillAdapter'
import { useTagList } from '../adapters/tagAdapter'
import { PENDING_BACKEND_TYPES } from '../constants'
import type { LibrarySidebarFilter, ResourceItem, ResourceType, SortKey } from '../types'

function compareItems(a: ResourceItem, b: ResourceItem, sort: SortKey): number {
  if (sort === 'name') return a.name.localeCompare(b.name, 'zh')
  const aKey = sort === 'createdAt' ? a.createdAt : a.updatedAt
  const bKey = sort === 'createdAt' ? b.createdAt : b.updatedAt
  return bKey.localeCompare(aKey)
}

export interface UseResourceLibraryOptions {
  sidebarFilter: LibrarySidebarFilter
  activeType: ResourceType | null
  activeTag: string | null
  search: string
  sort: SortKey
}

export interface UseResourceLibraryResult {
  resources: ResourceItem[]
  allResources: ResourceItem[]
  allTagsFromBackend: Tag[]
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
  pendingBackend: boolean
  pendingBackendTypes: ResourceType[]
  typeCounts: Record<ResourceType, number>
  refetch: () => void
}

export function useResourceLibrary({
  sidebarFilter,
  activeType,
  activeTag,
  search,
  sort
}: UseResourceLibraryOptions): UseResourceLibraryResult {
  const assistants = assistantAdapter.useList()
  const agents = agentAdapter.useList()
  const skills = skillAdapter.useList()
  const tagList = useTagList()

  const allResources = useMemo<ResourceItem[]>(() => {
    const assistantItems: ResourceItem[] = assistants.data.map((a) => ({
      id: a.id,
      type: 'assistant',
      name: a.name,
      description: a.description || '',
      avatar: a.emoji || '💬',
      // Embedded by AssistantService.list via JOIN on user_model; null when the
      // bound model row was removed.
      model: a.modelName ?? undefined,
      tags: a.tags.map((t) => t.name),
      tagRefs: a.tags,
      enabled: true,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      raw: a
    }))

    const agentItems: ResourceItem[] = agents.data.map((a) => {
      const avatarFromConfig = typeof a.configuration?.avatar === 'string' ? a.configuration.avatar : ''
      return {
        id: a.id,
        type: 'agent',
        name: a.name ?? '',
        description: a.description ?? '',
        avatar: avatarFromConfig || '🤖',
        model: a.model,
        tags: [],
        tagRefs: [],
        enabled: true,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        raw: a
      }
    })

    const skillItems: ResourceItem[] = skills.data.map((s) => ({
      id: s.id,
      type: 'skill',
      name: s.name,
      description: s.description ?? '',
      avatar: s.emoji || '⚡',
      version: s.version,
      author: s.author,
      source: s.source,
      tags: [],
      tagRefs: [],
      enabled: s.enabled ?? true,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      raw: s,
      pendingBackend: true
    }))

    return [...assistantItems, ...agentItems, ...skillItems]
  }, [assistants.data, agents.data, skills.data])

  const typeCounts = useMemo<Record<ResourceType, number>>(() => {
    const counts: Record<ResourceType, number> = { agent: 0, assistant: 0, skill: 0 }
    for (const r of allResources) counts[r.type] += 1
    return counts
  }, [allResources])

  const resources = useMemo<ResourceItem[]>(() => {
    let list = allResources
    if (sidebarFilter.type === 'resource') {
      list = list.filter((r) => r.type === sidebarFilter.resourceType)
    } else if (sidebarFilter.type === 'tag') {
      list = list.filter((r) => r.tags.includes(sidebarFilter.tagName))
    }
    if (activeTag) list = list.filter((r) => r.tags.includes(activeTag))
    if (activeType) list = list.filter((r) => r.type === activeType)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => compareItems(a, b, sort))
  }, [allResources, sidebarFilter, activeTag, activeType, search, sort])

  const pendingBackend = useMemo(() => {
    if (sidebarFilter.type === 'resource') return PENDING_BACKEND_TYPES.has(sidebarFilter.resourceType)
    if (activeType) return PENDING_BACKEND_TYPES.has(activeType)
    return false
  }, [sidebarFilter, activeType])

  const isLoading = assistants.isLoading || agents.isLoading || skills.isLoading
  const isRefreshing = assistants.isRefreshing || agents.isRefreshing || skills.isRefreshing
  const error = assistants.error ?? agents.error ?? skills.error

  const refetch = useCallback(() => {
    assistants.refetch()
    agents.refetch()
    skills.refetch()
    tagList.refetch()
  }, [assistants, agents, skills, tagList])

  return {
    resources,
    allResources,
    allTagsFromBackend: tagList.tags,
    isLoading,
    isRefreshing,
    error,
    pendingBackend,
    pendingBackendTypes: Array.from(PENDING_BACKEND_TYPES),
    typeCounts,
    refetch
  }
}
