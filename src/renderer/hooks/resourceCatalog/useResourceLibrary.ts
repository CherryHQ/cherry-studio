import { useTagList } from '@renderer/hooks/useTags'
import type { AgentDetail, ResourceItem, ResourceType, SortKey } from '@renderer/types/resourceCatalog'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import type { Tag } from '@shared/data/types/tag'
import { useCallback, useMemo } from 'react'

import { agentAdapter } from './agentAdapter'
import { assistantAdapter } from './assistantAdapter'
import { promptAdapter } from './promptAdapter'
import { skillAdapter } from './skillAdapter'

function compareItems(a: ResourceItem, b: ResourceItem, sort: SortKey): number {
  if (sort === 'name') return a.name.localeCompare(b.name, 'zh')
  const aKey = sort === 'createdAt' ? a.createdAt : a.updatedAt
  const bKey = sort === 'createdAt' ? b.createdAt : b.updatedAt
  return bKey.localeCompare(aKey)
}

export interface UseResourceLibraryOptions {
  resourceType: ResourceType
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
  refetch: () => void
}

export function useResourceLibrary({
  resourceType,
  activeTag,
  search,
  sort
}: UseResourceLibraryOptions): UseResourceLibraryResult {
  const tagList = useTagList()

  const trimmedSearch = search.trim() || undefined
  const isAssistant = resourceType === 'assistant'
  const isAgent = resourceType === 'agent'
  const isSkill = resourceType === 'skill'
  const isPrompt = resourceType === 'prompt'

  const assistantTagsActive = isAssistant && Boolean(activeTag)

  // Assistant needs two reads:
  // - Base (no params): powers assistant tag chips so they don't collapse when
  //   the user types in the search box.
  //   Also the authoritative source for tag-name → tag-id resolution below.
  // - Filtered: powers the visible grid. When `trimmedSearch`/`tagIds` are
  //   undefined the SWR key matches the base read and the call is deduped, so
  //   there's no extra network hit until the user actually filters.
  const baseAssistants = assistantAdapter.useList({ enabled: isAssistant })

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
    if (!activeTag) return undefined
    const id = tagIdByName.get(activeTag)
    return id ? [id] : undefined
  }, [activeTag, assistantTagsActive, tagIdByName])

  // Defensive guard for the rare race where the user has a chip selected but
  // we can't resolve its id (e.g. base data reset between click and filter
  // resolve, or the tag was deleted server-side). Without this, the filtered
  // query would degrade to "no tag filter" and surface every resource —
  // misleading for a user who explicitly picked a tag.
  const hasUnresolvedTagSelection = isAssistant && Boolean(activeTag) && tagIds === undefined

  const filteredAssistants = assistantAdapter.useList({
    enabled: isAssistant,
    search: isAssistant ? trimmedSearch : undefined,
    tagIds: isAssistant ? tagIds : undefined
  })
  const agents = agentAdapter.useList({ enabled: isAgent, search: isAgent ? trimmedSearch : undefined })
  const skills = skillAdapter.useList({ enabled: isSkill, search: isSkill ? trimmedSearch : undefined })
  const prompts = promptAdapter.useList({ enabled: isPrompt, search: isPrompt ? trimmedSearch : undefined })

  const buildAssistantItem = useCallback((a: Assistant): ResourceItem => {
    // Defensive optional access: schema declares tags as required, but stale DataApi
    // cache or a row from a code path that bypasses the embed helper can still hand
    // us undefined here.
    const tag = a.tags?.[0]
    return {
      id: a.id,
      type: 'assistant',
      name: a.name,
      description: a.description || '',
      avatar: a.emoji || '💬',
      // Embedded by AssistantService.list via JOIN on user_model; null when the
      // bound model row was removed.
      model: a.modelName ?? undefined,
      tag: tag?.name,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      raw: a
    }
  }, [])

  const buildAgentItem = useCallback((a: AgentDetail): ResourceItem => {
    return {
      id: a.id,
      type: 'agent',
      name: a.name ?? '',
      description: a.description ?? '',
      avatar: getAgentAvatarFromConfiguration(a.configuration),
      model: a.modelName ?? undefined,
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
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      raw: p
    }
  }, [])

  const allResources = useMemo<ResourceItem[]>(() => {
    if (isAssistant) return baseAssistants.data.map(buildAssistantItem)
    if (isAgent) return agents.data.map(buildAgentItem)
    if (isPrompt) return prompts.data.map(buildPromptItem)
    return skills.data.map(buildSkillItem)
  }, [
    isAssistant,
    isAgent,
    isPrompt,
    baseAssistants.data,
    agents.data,
    skills.data,
    prompts.data,
    buildAssistantItem,
    buildAgentItem,
    buildSkillItem,
    buildPromptItem
  ])

  const filteredAssistantItems = useMemo(
    () => filteredAssistants.data.map(buildAssistantItem),
    [filteredAssistants.data, buildAssistantItem]
  )
  const agentItems = useMemo(() => agents.data.map(buildAgentItem), [agents.data, buildAgentItem])
  const skillItems = useMemo(() => skills.data.map(buildSkillItem), [skills.data, buildSkillItem])
  const promptItems = useMemo(() => prompts.data.map(buildPromptItem), [prompts.data, buildPromptItem])

  const resources = useMemo<ResourceItem[]>(() => {
    // Tag selected but unresolvable → return empty rather than degrading to
    // an unfiltered grid. See `hasUnresolvedTagSelection` above.
    if (hasUnresolvedTagSelection) return []

    let list: ResourceItem[]
    if (isAssistant) list = filteredAssistantItems
    else if (isAgent) list = agentItems
    else if (isPrompt) list = promptItems
    else list = skillItems

    return [...list].sort((a, b) => compareItems(a, b, sort))
  }, [
    hasUnresolvedTagSelection,
    isAssistant,
    isAgent,
    isPrompt,
    filteredAssistantItems,
    agentItems,
    promptItems,
    skillItems,
    sort
  ])

  const isLoading = isAssistant
    ? baseAssistants.isLoading || filteredAssistants.isLoading
    : isAgent
      ? agents.isLoading
      : isPrompt
        ? prompts.isLoading
        : skills.isLoading
  const isRefreshing = isAssistant
    ? baseAssistants.isRefreshing || filteredAssistants.isRefreshing
    : isAgent
      ? agents.isRefreshing
      : isPrompt
        ? prompts.isRefreshing
        : skills.isRefreshing
  const error = isAssistant
    ? (baseAssistants.error ?? filteredAssistants.error)
    : isAgent
      ? agents.error
      : isPrompt
        ? prompts.error
        : skills.error

  const baseAssistantsRefetch = baseAssistants.refetch
  const filteredAssistantsRefetch = filteredAssistants.refetch
  const agentsRefetch = agents.refetch
  const skillsRefetch = skills.refetch
  const promptsRefetch = prompts.refetch
  const tagListRefetch = tagList.refetch

  const refetch = useCallback(() => {
    if (isAssistant) {
      baseAssistantsRefetch()
      filteredAssistantsRefetch()
      tagListRefetch()
    } else if (isAgent) {
      agentsRefetch()
    } else if (isPrompt) {
      promptsRefetch()
    } else {
      skillsRefetch()
    }
  }, [
    isAssistant,
    isAgent,
    isPrompt,
    baseAssistantsRefetch,
    filteredAssistantsRefetch,
    agentsRefetch,
    skillsRefetch,
    promptsRefetch,
    tagListRefetch
  ])

  return {
    resources,
    allResources,
    isLoading,
    isRefreshing,
    error,
    refetch
  }
}
