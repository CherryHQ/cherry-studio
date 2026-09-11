import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import { createUniqueModelId } from '@shared/data/types/model'

import { useBundledCatalog } from './useBundledCatalog'

export const ASSISTANT_CATALOG_MY_TAB = '__mine__'

interface AssistantCatalogModel {
  id?: string
  provider?: string
  name?: string
  group?: string
}

export interface AssistantCatalogPreset {
  id: string
  name: string
  prompt?: string
  description?: string
  emoji?: string
  group?: string[]
  defaultModel?: AssistantCatalogModel
}

export interface AssistantCatalogTab {
  id: string
  label: string
  count: number
}

const ORDERED_GROUP_ALIASES = [
  ['精选', 'Featured'],
  ['职业', 'Career'],
  ['商业', 'Business'],
  ['工具', 'Tools'],
  ['语言', 'Language'],
  ['办公', 'Office'],
  ['通用', 'General'],
  ['写作', 'Writing'],
  ['编程', 'Programming'],
  ['情感', 'Emotional'],
  ['教育', 'Education'],
  ['创意', 'Creative'],
  ['学术', 'Academic'],
  ['设计', 'Design'],
  ['艺术', 'Art'],
  ['娱乐', 'Entertainment'],
  ['生活', 'Life']
]

const orderedGroupRank = new Map<string, number>()
ORDERED_GROUP_ALIASES.forEach((aliases, index) => {
  aliases.forEach((alias) => orderedGroupRank.set(alias, index))
})

function normalizePresets(value: unknown): AssistantCatalogPreset[] {
  if (!Array.isArray(value)) return []

  return value.filter((preset): preset is AssistantCatalogPreset => {
    return Boolean(
      preset &&
      typeof preset === 'object' &&
      typeof (preset as AssistantCatalogPreset).id === 'string' &&
      typeof (preset as AssistantCatalogPreset).name === 'string'
    )
  })
}

function getPresetGroups(preset: AssistantCatalogPreset): string[] {
  return Array.isArray(preset.group) ? preset.group.filter(Boolean) : []
}

function sortGroups(a: string, b: string) {
  const rankA = orderedGroupRank.get(a) ?? Number.MAX_SAFE_INTEGER
  const rankB = orderedGroupRank.get(b) ?? Number.MAX_SAFE_INTEGER
  if (rankA !== rankB) return rankA - rankB
  return a.localeCompare(b, 'zh')
}

export function buildAssistantCatalogTabs(
  presets: AssistantCatalogPreset[],
  mineCount: number,
  mineLabel: string
): AssistantCatalogTab[] {
  const counts = new Map<string, number>()

  presets.forEach((preset) => {
    getPresetGroups(preset).forEach((group) => counts.set(group, (counts.get(group) ?? 0) + 1))
  })

  const systemTabs = Array.from(counts.entries())
    .sort(([a], [b]) => sortGroups(a, b))
    .map(([id, count]) => ({
      id,
      label: id,
      count
    }))

  return [{ id: ASSISTANT_CATALOG_MY_TAB, label: mineLabel, count: mineCount }, ...systemTabs]
}

export function filterAssistantCatalogPresets(
  presets: AssistantCatalogPreset[],
  activeTab: string,
  search: string
): AssistantCatalogPreset[] {
  if (activeTab === ASSISTANT_CATALOG_MY_TAB) return []

  const keyword = search.trim().toLowerCase()
  return presets.filter((preset) => {
    if (!getPresetGroups(preset).includes(activeTab)) return false
    if (!keyword) return true

    return [preset.name, preset.description, preset.prompt]
      .filter(Boolean)
      .some((text) => text?.toLowerCase().includes(keyword))
  })
}

export function getAssistantPresetCatalogKey(preset: Pick<AssistantCatalogPreset, 'id'>) {
  return preset.id
}

export function toCreateAssistantDtoFromCatalogPreset(preset: AssistantCatalogPreset): CreateAssistantDto {
  const dto: CreateAssistantDto = {
    name: preset.name.trim(),
    prompt: preset.prompt?.trim() || ''
  }

  const description = preset.description?.trim()
  if (description) dto.description = description

  const emoji = preset.emoji?.trim()
  if (emoji) dto.emoji = emoji

  if (preset.defaultModel?.provider && preset.defaultModel.id) {
    dto.modelId = createUniqueModelId(preset.defaultModel.provider, preset.defaultModel.id)
  }

  return dto
}

async function loadCatalogPresets(resourcesPath: string, language: string) {
  const fileName = language === 'zh-CN' ? 'agents-zh.json' : 'agents-en.json'
  const content = await window.api.fs.read(`${resourcesPath}/data/${fileName}`, 'utf-8')
  return normalizePresets(JSON.parse(content))
}

export function useAssistantCatalogPresets({ enabled = true }: { enabled?: boolean } = {}) {
  const { isLoading, items: presets } = useBundledCatalog({
    catalog: 'assistant presets',
    enabled,
    load: loadCatalogPresets
  })

  return {
    isLoading,
    presets
  }
}
