import { preferenceService } from '@data/PreferenceService'
import { getStoreProviders } from '@renderer/hooks/useStore'
import type { MemoryConfig } from '@renderer/types'
import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

const UNIQUE_MODEL_ID_SEPARATOR = '::'

function parseUniqueModelId(uniqueId: string): { providerId: string; modelId: string } | null {
  const idx = uniqueId.indexOf(UNIQUE_MODEL_ID_SEPARATOR)
  if (idx === -1) return null
  return {
    providerId: uniqueId.slice(0, idx),
    modelId: uniqueId.slice(idx + UNIQUE_MODEL_ID_SEPARATOR.length)
  }
}

export type MemoryPreferenceValues = {
  embeddingDimensions: number
  isAutoDimensions: boolean
  customFactExtractionPrompt: string
  customUpdateMemoryPrompt: string
  llmModelId: string | null
  embeddingModelId: string | null
}

export const MEMORY_PREFERENCE_KEYS = {
  embeddingDimensions: 'feature.memory.embedder_dimensions',
  isAutoDimensions: 'feature.memory.auto_dimensions',
  customFactExtractionPrompt: 'feature.memory.fact_extraction_prompt',
  customUpdateMemoryPrompt: 'feature.memory.update_memory_prompt',
  llmModelId: 'feature.memory.llm_model_id',
  embeddingModelId: 'feature.memory.embedding_model_id'
} as const satisfies Record<string, PreferenceKeyType>

export async function getMemoryPreferenceValues(): Promise<MemoryPreferenceValues> {
  return preferenceService.getMultiple(MEMORY_PREFERENCE_KEYS)
}

export function resolveMemoryConfig(values: MemoryPreferenceValues): MemoryConfig {
  const providers = getStoreProviders()
  const allModels = providers.flatMap((provider) => provider.models)

  const findModelByUniqueId = (uniqueId: string | null) => {
    if (!uniqueId) return undefined
    const parsed = parseUniqueModelId(uniqueId)
    if (!parsed) return undefined
    return allModels.find((model) => model.id === parsed.modelId && model.provider === parsed.providerId)
  }

  const llmModel = findModelByUniqueId(values.llmModelId)
  const embeddingModel = findModelByUniqueId(values.embeddingModelId)

  return {
    embeddingDimensions: values.isAutoDimensions ? undefined : values.embeddingDimensions,
    embeddingModel,
    llmModel,
    customFactExtractionPrompt: values.customFactExtractionPrompt || '',
    customUpdateMemoryPrompt: values.customUpdateMemoryPrompt || '',
    isAutoDimensions: values.isAutoDimensions
  }
}

export async function getMemoryConfigFromPreferences(): Promise<MemoryConfig> {
  const values = await getMemoryPreferenceValues()
  return resolveMemoryConfig(values)
}

export async function setMemoryConfigToPreferences(memoryConfig: MemoryConfig): Promise<void> {
  const buildUniqueModelId = (model?: { id: string; provider: string } | null): string | null => {
    if (!model?.id || !model?.provider) return null
    return `${model.provider}${UNIQUE_MODEL_ID_SEPARATOR}${model.id}`
  }

  const modelUpdates = {
    'feature.memory.llm_model_id': buildUniqueModelId(memoryConfig.llmModel),
    'feature.memory.embedding_model_id': buildUniqueModelId(memoryConfig.embeddingModel)
  } as const

  const updates: Partial<PreferenceDefaultScopeType> = {
    'feature.memory.fact_extraction_prompt': memoryConfig.customFactExtractionPrompt ?? '',
    'feature.memory.update_memory_prompt': memoryConfig.customUpdateMemoryPrompt ?? ''
  }

  // Temporary workaround:
  // main PreferenceService.setMultiple rejects null values, so write nullable model fields one by one.
  for (const [key, value] of Object.entries(modelUpdates) as Array<
    [keyof typeof modelUpdates, (typeof modelUpdates)[keyof typeof modelUpdates]]
  >) {
    if (value === null) {
      await preferenceService.set(key, value, { optimistic: false })
      continue
    }
    updates[key] = value
  }

  if (typeof memoryConfig.embeddingDimensions === 'number') {
    updates['feature.memory.embedder_dimensions'] = memoryConfig.embeddingDimensions
  }

  if (typeof memoryConfig.isAutoDimensions === 'boolean') {
    updates['feature.memory.auto_dimensions'] = memoryConfig.isAutoDimensions
  }

  if (Object.keys(updates).length > 0) {
    await preferenceService.setMultiple(updates, { optimistic: false })
  }
}
