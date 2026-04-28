import type { AgentDetail, InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
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
  activeTag,
  search,
  sort
}: UseResourceLibraryOptions): UseResourceLibraryResult {
  const tagList = useTagList()

  const trimmedSearch = search.trim() || undefined

  // Two reads per filterable type:
  // - Base (no params): powers `typeCounts` and `allResources` so the sidebar
  //   numbers / chip set don't collapse when the user types in the search box.
  //   Also the authoritative source for tag-name → tag-id resolution below.
  // - Filtered: powers the visible grid. When `trimmedSearch`/`tagIds` are
  //   undefined the SWR key matches the base read and the call is deduped, so
  //   there's no extra network hit until the user actually filters.
  const baseAssistants = assistantAdapter.useList()
  const baseAgents = agentAdapter.useList()
  const skills = skillAdapter.useList()

  // Resolve tag names to ids primarily from the embedded `tagRefs` we already
  // have on base data — every chip the user can click was rendered from a
  // resource in this set, so its id is guaranteed to be here. Falling back to
  // `useTagList()` alone would race: if `/tags` is slow or fails after the user
  // clicks a chip, we'd send `tagIds: undefined` and silently show the full
  // unfiltered list. `tagList.tags` only fills in for tags that exist
  // server-side but aren't bound to any visible resource yet (sidebar `tag`
  // mode), so it stays as a tail fallback.
  const tagIdByName = useMemo(() => {
    const map = new Map<string, string>()
    const collect = (refs: Tag[] | undefined) => {
      if (!refs) return
      for (const t of refs) if (!map.has(t.name)) map.set(t.name, t.id)
    }
    for (const a of baseAssistants.data) collect(a.tags)
    for (const a of baseAgents.data) collect(a.tags)
    for (const s of skills.data) collect(s.tags)
    for (const t of tagList.tags) if (!map.has(t.name)) map.set(t.name, t.id)
    return map
  }, [baseAssistants.data, baseAgents.data, skills.data, tagList.tags])

  // Resolved query filter (omitted entirely if no tag is selected). Empty
  // arrays are forbidden by the backend schema (`tagIds.min(1)`), so we drop
  // the param when nothing resolves rather than sending a 400.
  const tagIds = useMemo(() => {
    const names = [activeTag, sidebarFilter.type === 'tag' ? sidebarFilter.tagName : null].filter((x): x is string =>
      Boolean(x)
    )
    if (names.length === 0) return undefined
    const ids = names.flatMap((name) => {
      const id = tagIdByName.get(name)
      return id ? [id] : []
    })
    return ids.length > 0 ? ids : undefined
  }, [activeTag, sidebarFilter, tagIdByName])

  // Defensive guard for the rare race where the user has a chip selected but
  // we can't resolve its id (e.g. base data reset between click and filter
  // resolve, or the tag was deleted server-side). Without this, the filtered
  // query would degrade to "no tag filter" and surface every resource —
  // misleading for a user who explicitly picked a tag.
  const hasUnresolvedTagSelection = (Boolean(activeTag) || sidebarFilter.type === 'tag') && tagIds === undefined

  const filteredAssistants = assistantAdapter.useList({ search: trimmedSearch, tagIds })
  const filteredAgents = agentAdapter.useList({ search: trimmedSearch, tagIds })
  // Skip the filtered fetch when skills are not displayed (sidebar pinned to
  // assistant or agent). With no args the adapter shares the same cache key
  // as the unfiltered `skills` call above, so we don't pay an extra request.
  const skillsVisible = sidebarFilter.type !== 'resource' || sidebarFilter.resourceType === 'skill'
  const filteredSkills = skillAdapter.useList(skillsVisible ? { search: trimmedSearch, tagIds } : undefined)

  const buildAssistantItem = useCallback((a: Assistant): ResourceItem => {
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
  }, [])

  const buildAgentItem = useCallback((a: AgentDetail): ResourceItem => {
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
  }, [])

  const buildSkillItem = useCallback((s: InstalledSkill): ResourceItem => {
    const tags = s.tags ?? []
    return {
      id: s.id,
      type: 'skill',
      name: s.name,
      description: s.description ?? '',
      // No emoji on InstalledSkill — fall back to the lightning glyph.
      avatar: '⚡',
      author: s.author ?? undefined,
      source: s.source,
      // `tags` are user-bound global tags from entity_tag. Skill metadata
      // tags from SKILL.md live on `sourceTags` and are intentionally not used
      // for resource-library filtering.
      tags: tags.map((t) => t.name),
      tagRefs: tags,
      // The library list is global (no agentId), so `isEnabled` is forced to
      // false on the wire. Show every skill as available; per-agent toggling
      // happens inside the agent editor.
      enabled: true,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      raw: s
    }
  }, [])

  const allResources = useMemo<ResourceItem[]>(
    () => [
      ...baseAssistants.data.map(buildAssistantItem),
      ...baseAgents.data.map(buildAgentItem),
      ...skills.data.map(buildSkillItem)
    ],
    [baseAssistants.data, baseAgents.data, skills.data, buildAssistantItem, buildAgentItem, buildSkillItem]
  )

  const typeCounts = useMemo<Record<ResourceType, number>>(() => {
    const counts: Record<ResourceType, number> = { agent: 0, assistant: 0, skill: 0 }
    for (const r of allResources) counts[r.type] += 1
    return counts
  }, [allResources])

  const filteredAssistantItems = useMemo(
    () => filteredAssistants.data.map(buildAssistantItem),
    [filteredAssistants.data, buildAssistantItem]
  )
  const filteredAgentItems = useMemo(
    () => filteredAgents.data.map(buildAgentItem),
    [filteredAgents.data, buildAgentItem]
  )
  const skillItems = useMemo(() => filteredSkills.data.map(buildSkillItem), [filteredSkills.data, buildSkillItem])

  const resources = useMemo<ResourceItem[]>(() => {
    // Tag selected but unresolvable → return empty rather than degrading to
    // an unfiltered grid. See `hasUnresolvedTagSelection` above.
    if (hasUnresolvedTagSelection) return []

    // Pick the active resource bucket. Sidebar's `tag` mode is currently
    // unused (no UI dispatches it), but we honor the type union by falling
    // back to the union of all server-filtered results.
    let list: ResourceItem[]
    if (sidebarFilter.type === 'resource') {
      if (sidebarFilter.resourceType === 'assistant') list = filteredAssistantItems
      else if (sidebarFilter.resourceType === 'agent') list = filteredAgentItems
      else list = skillItems
    } else {
      list = [...filteredAssistantItems, ...filteredAgentItems, ...skillItems]
    }

    return [...list].sort((a, b) => compareItems(a, b, sort))
  }, [hasUnresolvedTagSelection, sidebarFilter, filteredAssistantItems, filteredAgentItems, skillItems, sort])

  const pendingBackend = useMemo(() => {
    if (sidebarFilter.type === 'resource') return PENDING_BACKEND_TYPES.has(sidebarFilter.resourceType)
    return false
  }, [sidebarFilter])

  const isLoading =
    baseAssistants.isLoading ||
    filteredAssistants.isLoading ||
    baseAgents.isLoading ||
    filteredAgents.isLoading ||
    skills.isLoading ||
    filteredSkills.isLoading
  const isRefreshing =
    baseAssistants.isRefreshing ||
    filteredAssistants.isRefreshing ||
    baseAgents.isRefreshing ||
    filteredAgents.isRefreshing ||
    skills.isRefreshing ||
    filteredSkills.isRefreshing
  const error =
    baseAssistants.error ??
    filteredAssistants.error ??
    baseAgents.error ??
    filteredAgents.error ??
    skills.error ??
    filteredSkills.error

  const refetch = useCallback(() => {
    baseAssistants.refetch()
    filteredAssistants.refetch()
    baseAgents.refetch()
    filteredAgents.refetch()
    skills.refetch()
    filteredSkills.refetch()
    tagList.refetch()
  }, [baseAssistants, filteredAssistants, baseAgents, filteredAgents, skills, filteredSkills, tagList])

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
