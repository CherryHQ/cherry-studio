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
    const assistantItems: ResourceItem[] = assistants.data.map((a) => {
      // Defensive `?? []`: schema declares tags as required, but stale DataApi
      // cache or a row from a code path that bypasses the embed helper can
      // still hand us undefined here. `.map` would throw.
      const tags = a.tags ?? []
      return {
        id: a.id,
        type: 'assistant',
        name: a.name,
        description: a.description || '',
        avatar: a.emoji || '💬',
        // Embedded by AssistantService.list via JOIN on user_model; null when the
        // bound model row was removed.
        model: a.modelName ?? undefined,
        tags: tags.map((t) => t.name),
        tagRefs: tags,
        enabled: true,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        raw: a
      }
    })

    const agentItems: ResourceItem[] = agents.data.map((a) => {
      const avatarFromConfig = typeof a.configuration?.avatar === 'string' ? a.configuration.avatar : ''
      const tags = a.tags ?? []
      return {
        id: a.id,
        type: 'agent',
        name: a.name ?? '',
        description: a.description ?? '',
        avatar: avatarFromConfig || '🤖',
        model: a.modelName ?? undefined,
        tags: tags.map((t) => t.name),
        tagRefs: tags,
        enabled: true,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        raw: a
      }
    })

    const skillItems: ResourceItem[] = skills.data.map((s) => ({
      id: s.id,
      type: 'skill',
      name: s.name,
      description: s.description ?? '',
      // No emoji on InstalledSkill — fall back to the lightning glyph.
      avatar: '⚡',
      author: s.author ?? undefined,
      source: s.source,
      // Skills tag-binding is a follow-up: backend `agent_global_skill` has a
      // `tags` text-array column already, but the resource library doesn't
      // edit it yet. Surface read-only chips so the UI stays consistent.
      tags: s.tags ?? [],
      tagRefs: [],
      // The library list is global (no agentId), so `isEnabled` is forced to
      // false on the wire. Show every skill as available; per-agent toggling
      // happens inside the agent editor.
      enabled: true,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      raw: s
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
