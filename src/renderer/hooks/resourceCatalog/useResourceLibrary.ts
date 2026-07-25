import { useGroups } from '@renderer/hooks/useGroups'
import type { AgentDetail, ResourceItem, ResourceType, SortKey } from '@renderer/types/resourceCatalog'
import { getAgentAvatarFromConfiguration, getAgentDescriptionForDisplay } from '@renderer/utils/agent'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
  activeGroupId: string | null
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
  activeGroupId,
  search,
  sort
}: UseResourceLibraryOptions): UseResourceLibraryResult {
  const { t } = useTranslation()
  const assistantGroups = useGroups('assistant')

  const trimmedSearch = search.trim() || undefined
  const isAssistant = resourceType === 'assistant'
  const isAgent = resourceType === 'agent'
  const isSkill = resourceType === 'skill'
  const isPrompt = resourceType === 'prompt'

  // Assistant needs two reads:
  // - Base (no params): powers assistant group chips so they don't collapse when
  //   the user types in the search box.
  // - Filtered: powers the visible grid. When `trimmedSearch`/`groupId` are
  //   undefined the SWR key matches the base read and the call is deduped, so
  //   there's no extra network hit until the user actually filters.
  const baseAssistants = assistantAdapter.useList({ enabled: isAssistant })

  const groupById = useMemo(
    () => new Map(assistantGroups.groups.map((group) => [group.id, group] as const)),
    [assistantGroups.groups]
  )

  const filteredAssistants = assistantAdapter.useList({
    enabled: isAssistant,
    search: isAssistant ? trimmedSearch : undefined,
    groupId: isAssistant ? (activeGroupId ?? undefined) : undefined
  })
  // Agent search stays server-side so matching spans the full database, not only the
  // current page. The main service resolves the builtin fallback description for this predicate.
  const agents = agentAdapter.useList({ enabled: isAgent, search: isAgent ? trimmedSearch : undefined })
  const skills = skillAdapter.useList({ enabled: isSkill, search: isSkill ? trimmedSearch : undefined })
  const prompts = promptAdapter.useList({ enabled: isPrompt, search: isPrompt ? trimmedSearch : undefined })

  const buildAssistantItem = useCallback(
    (a: Assistant): ResourceItem => {
      const group = a.groupId ? groupById.get(a.groupId) : undefined
      return {
        id: a.id,
        type: 'assistant',
        name: a.name,
        description: a.description || '',
        avatar: a.emoji || '💬',
        // Embedded by AssistantService.list via JOIN on user_model; null when the
        // bound model row was removed.
        model: a.modelName ?? undefined,
        groupId: a.groupId ?? undefined,
        groupName: group?.name,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        raw: a
      }
    },
    [groupById]
  )

  const buildAgentItem = useCallback(
    (a: AgentDetail): ResourceItem => {
      return {
        id: a.id,
        type: 'agent',
        name: a.name ?? '',
        description: getAgentDescriptionForDisplay(a, t),
        avatar: getAgentAvatarFromConfiguration(a.configuration),
        model: a.modelName ?? undefined,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        raw: a
      }
    },
    [t]
  )

  const buildSkillItem = useCallback((s: InstalledSkill): ResourceItem => {
    return {
      id: s.id,
      type: 'skill',
      name: s.name,
      description: s.description ?? '',
      // No emoji on InstalledSkill — fall back to the lightning glyph.
      avatar: '⚡',
      // Skill metadata tags from SKILL.md live on `sourceTags`; assistant
      // organization in the resource library uses Group rows instead.
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
    let list: ResourceItem[]
    if (isAssistant) list = filteredAssistantItems
    else if (isAgent) list = agentItems
    else if (isPrompt) list = promptItems
    else list = skillItems

    return [...list].sort((a, b) => compareItems(a, b, sort))
  }, [isAssistant, isAgent, isPrompt, filteredAssistantItems, agentItems, promptItems, skillItems, sort])

  const isLoading = isAssistant
    ? baseAssistants.isLoading || filteredAssistants.isLoading || assistantGroups.isLoading
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
    ? (baseAssistants.error ?? filteredAssistants.error ?? assistantGroups.error)
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
  const groupsRefetch = assistantGroups.refetch

  const refetch = useCallback(() => {
    if (isAssistant) {
      baseAssistantsRefetch()
      filteredAssistantsRefetch()
      void groupsRefetch()
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
    groupsRefetch
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
