import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import { createUniqueModelId } from '@shared/data/types/model'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const ASSISTANT_CATALOG_MY_TAB = '__mine__'

interface AssistantCatalogModel {
  id?: string
  provider?: string
  name?: string
  group?: string
}

export interface AssistantCatalogPreset {
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

interface UseAssistantPresetCatalogOptions {
  activeTab: string
  search: string
  mineCount: number
  enabled: boolean
}

const logger = loggerService.withContext('useAssistantPresetCatalog')

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

function toLogContext(error: unknown) {
  return error instanceof Error ? error : { error: String(error) }
}

function normalizePresets(value: unknown): AssistantCatalogPreset[] {
  if (!Array.isArray(value)) return []

  return value.filter((preset): preset is AssistantCatalogPreset => {
    return Boolean(preset && typeof preset === 'object' && typeof (preset as AssistantCatalogPreset).name === 'string')
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

export function getAssistantPresetCatalogKey(preset: Pick<AssistantCatalogPreset, 'name' | 'prompt' | 'description'>) {
  return `${preset.name.trim()}\n${(preset.prompt || preset.description || '').trim()}`
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

async function getAssistantSubscribeUrl() {
  const { default: store } = await import('@renderer/store')
  return store.getState().settings.agentssubscribeUrl
}

async function readLocalPresets(language: string) {
  const resourcesPath = cacheService.get('app.path.resources')
  if (!resourcesPath) return []

  const fileName = language === 'zh-CN' ? 'agents-zh.json' : 'agents-en.json'
  const content = await window.api.fs.read(`${resourcesPath}/data/${fileName}`, 'utf-8')
  return normalizePresets(JSON.parse(content))
}

async function loadCatalogPresets(language: string) {
  try {
    const subscribeUrl = await getAssistantSubscribeUrl()
    if (subscribeUrl?.startsWith('http')) {
      const response = await fetch(subscribeUrl)
      if (response.ok) return normalizePresets(await response.json())
    }
  } catch (error) {
    logger.warn('Failed to load assistant presets from subscription, falling back to local data', toLogContext(error))
  }

  try {
    return await readLocalPresets(language)
  } catch (error) {
    logger.error('Failed to load local assistant presets', toLogContext(error))
    return []
  }
}

export function useAssistantPresetCatalog({ activeTab, search, mineCount, enabled }: UseAssistantPresetCatalogOptions) {
  const { i18n, t } = useTranslation()
  const language = i18n?.language ?? 'en-US'
  const [presets, setPresets] = useState<AssistantCatalogPreset[]>([])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    void loadCatalogPresets(language)
      .then((loadedPresets) => {
        if (!cancelled) setPresets(loadedPresets)
      })
      .catch((error) => {
        logger.error('Unexpected failure while loading assistant presets', toLogContext(error))
      })

    return () => {
      cancelled = true
    }
  }, [enabled, language])

  const tabs = useMemo(
    () => buildAssistantCatalogTabs(presets, mineCount, t('library.assistant_catalog.mine')),
    [mineCount, presets, t]
  )

  const filteredPresets = useMemo(
    () => filterAssistantCatalogPresets(presets, activeTab, search),
    [activeTab, presets, search]
  )

  return {
    tabs,
    presets: filteredPresets
  }
}
