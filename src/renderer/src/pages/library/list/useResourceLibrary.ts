import type { AgentDetail, InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import type { Tag } from '@shared/data/types/tag'
import { useCallback, useMemo } from 'react'

import { agentAdapter } from '../adapters/agentAdapter'
import { assistantAdapter } from '../adapters/assistantAdapter'
import { promptAdapter } from '../adapters/promptAdapter'
import { skillAdapter } from '../adapters/skillAdapter'
import { useTagList } from '../adapters/tagAdapter'
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
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
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

  const assistantTagsActive = sidebarFilter.resourceType === 'assistant' && Boolean(activeTag)

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
  const basePrompts = promptAdapter.useList()

  // Resolve assistant tag names to ids primarily from the embedded tags we already
  // have on base data — every chip the user can click was rendered from a
  // resource in this set, so its id is guaranteed to be here. Falling back to
  // `useTagList()` alone would race: if `/tags` is slow or fails after the user
  // clicks a chip, we'd send `tagIds: undefined` and silently show the full
  // unfiltered list. `tagList.tags` only fills in for tags that exist
  // server-side but aren't bound to any visible resource yet, so it stays as a
  // tail fallback.
  const tagIdByName = useMemo(() => {
    const map = new Map<string, string>()
    const collect = (refs: Tag[] | undefined) => {
      if (!refs) return
      for (const t of refs) if (!map.has(t.name)) map.set(t.name, t.id)
    }
    for (const a of baseAssistants.data) collect(a.tags)
    for (const t of tagList.tags) if (!map.has(t.name)) map.set(t.name, t.id)
    return map
  }, [baseAssistants.data, tagList.tags])

  // Resolved query filter (omitted entirely if no tag is selected). Empty
  // arrays are forbidden by the backend schema (`tagIds.min(1)`), so we drop
  // the param when nothing resolves rather than sending a 400.
  const tagIds = useMemo(() => {
    if (!assistantTagsActive) return undefined
    const names = [activeTag].filter((x): x is string => Boolean(x))
    if (names.length === 0) return undefined
    const ids = names.flatMap((name) => {
      const id = tagIdByName.get(name)
      return id ? [id] : []
    })
    return ids.length > 0 ? ids : undefined
  }, [activeTag, assistantTagsActive, tagIdByName])

  // Defensive guard for the rare race where the user has a chip selected but
  // we can't resolve its id (e.g. base data reset between click and filter
  // resolve, or the tag was deleted server-side). Without this, the filtered
  // query would degrade to "no tag filter" and surface every resource —
  // misleading for a user who explicitly picked a tag.
  const hasUnresolvedTagSelection =
    sidebarFilter.resourceType === 'assistant' && Boolean(activeTag) && tagIds === undefined

  const filteredAssistants = assistantAdapter.useList({ search: trimmedSearch, tagIds })
  const filteredAgents = agentAdapter.useList({ search: trimmedSearch })
  // Skip the filtered fetch when skills are not displayed (sidebar pinned to
  // assistant or agent). With no args the adapter shares the same cache key
  // as the unfiltered `skills` call above, so we don't pay an extra request.
  const skillsVisible = sidebarFilter.resourceType === 'skill'
  const filteredSkills = skillAdapter.useList(skillsVisible ? { search: trimmedSearch } : undefined)
  const promptsVisible = sidebarFilter.resourceType === 'prompt'
  const filteredPrompts = promptAdapter.useList(promptsVisible ? { search: trimmedSearch } : undefined)

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
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      raw: a
    }
  }, [])

  const buildAgentItem = useCallback((a: AgentDetail): ResourceItem => {
    const avatarFromConfig = typeof a.configuration?.avatar === 'string' ? a.configuration.avatar : ''
    return {
      id: a.id,
      type: 'agent',
      name: a.name ?? '',
      description: a.description ?? '',
      avatar: avatarFromConfig || '🤖',
      model: a.modelName ?? undefined,
      tags: [],
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      raw: a
    }
  }, [])

  const buildSkillItem = useCallback((s: InstalledSkill): ResourceItem => {
    return {
      id: s.id,
      type: 'skill',
      name: s.name,
      description: s.description ?? '',
      // No emoji on InstalledSkill — fall back to the lightning glyph.
      avatar: '⚡',
      // Skill metadata tags from SKILL.md live on `sourceTags`; the outer
      // resource-library user tag concept is assistant-only.
      tags: [],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      raw: s
    }
  }, [])

  const buildPromptItem = useCallback((p: Prompt): ResourceItem => {
    return {
      id: p.id,
      type: 'prompt',
      name: p.title,
      description: p.content.replace(/\s+/g, ' ').trim(),
      avatar: 'Aa',
      tags: [],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      raw: p
    }
  }, [])

  const allResources = useMemo<ResourceItem[]>(
    () => [
      ...baseAssistants.data.map(buildAssistantItem),
      ...baseAgents.data.map(buildAgentItem),
      ...skills.data.map(buildSkillItem),
      ...basePrompts.data.map(buildPromptItem)
    ],
    [
      baseAssistants.data,
      baseAgents.data,
      skills.data,
      basePrompts.data,
      buildAssistantItem,
      buildAgentItem,
      buildSkillItem,
      buildPromptItem
    ]
  )

  const typeCounts = useMemo<Record<ResourceType, number>>(() => {
    const counts: Record<ResourceType, number> = { agent: 0, assistant: 0, skill: 0, prompt: 0 }
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
  const promptItems = useMemo(() => filteredPrompts.data.map(buildPromptItem), [filteredPrompts.data, buildPromptItem])

  const resources = useMemo<ResourceItem[]>(() => {
    // Tag selected but unresolvable → return empty rather than degrading to
    // an unfiltered grid. See `hasUnresolvedTagSelection` above.
    if (hasUnresolvedTagSelection) return []

    let list: ResourceItem[]
    if (sidebarFilter.resourceType === 'assistant') list = filteredAssistantItems
    else if (sidebarFilter.resourceType === 'agent') list = filteredAgentItems
    else if (sidebarFilter.resourceType === 'prompt') list = promptItems
    else list = skillItems

    return [...list].sort((a, b) => compareItems(a, b, sort))
  }, [
    hasUnresolvedTagSelection,
    sidebarFilter,
    filteredAssistantItems,
    filteredAgentItems,
    promptItems,
    skillItems,
    sort
  ])

  const isLoading =
    baseAssistants.isLoading ||
    filteredAssistants.isLoading ||
    baseAgents.isLoading ||
    filteredAgents.isLoading ||
    skills.isLoading ||
    filteredSkills.isLoading ||
    basePrompts.isLoading ||
    filteredPrompts.isLoading
  const isRefreshing =
    baseAssistants.isRefreshing ||
    filteredAssistants.isRefreshing ||
    baseAgents.isRefreshing ||
    filteredAgents.isRefreshing ||
    skills.isRefreshing ||
    filteredSkills.isRefreshing ||
    basePrompts.isRefreshing ||
    filteredPrompts.isRefreshing
  const error =
    baseAssistants.error ??
    filteredAssistants.error ??
    baseAgents.error ??
    filteredAgents.error ??
    skills.error ??
    filteredSkills.error ??
    basePrompts.error ??
    filteredPrompts.error

  const refetch = useCallback(() => {
    baseAssistants.refetch()
    filteredAssistants.refetch()
    baseAgents.refetch()
    filteredAgents.refetch()
    skills.refetch()
    filteredSkills.refetch()
    basePrompts.refetch()
    filteredPrompts.refetch()
    tagList.refetch()
  }, [
    baseAssistants,
    filteredAssistants,
    baseAgents,
    filteredAgents,
    skills,
    filteredSkills,
    basePrompts,
    filteredPrompts,
    tagList
  ])

  return {
    resources,
    allResources,
    isLoading,
    isRefreshing,
    error,
    typeCounts,
    refetch
  }
}
