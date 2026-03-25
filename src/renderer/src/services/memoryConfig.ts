import { preferenceService } from '@data/PreferenceService'
import { getStoreProviders } from '@renderer/hooks/useStore'
import type { MemoryConfig } from '@renderer/types'
import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

export type MemoryPreferenceValues = {
  embeddingDimensions: number
  isAutoDimensions: boolean
  customFactExtractionPrompt: string
  customUpdateMemoryPrompt: string
  llmModelId: string | null
  llmModelProvider: string | null
  embeddingModelId: string | null
  embeddingModelProvider: string | null
}

export const MEMORY_PREFERENCE_KEYS = {
  embeddingDimensions: 'feature.memory.embedder_dimensions',
  isAutoDimensions: 'feature.memory.auto_dimensions',
  customFactExtractionPrompt: 'feature.memory.fact_extraction_prompt',
  customUpdateMemoryPrompt: 'feature.memory.update_memory_prompt',
  llmModelId: 'feature.memory.llm_model_id',
  llmModelProvider: 'feature.memory.llm_model_provider',
  embeddingModelId: 'feature.memory.embedding_model_id',
  embeddingModelProvider: 'feature.memory.embedding_model_provider'
} as const satisfies Record<string, PreferenceKeyType>

export async function getMemoryPreferenceValues(): Promise<MemoryPreferenceValues> {
  return preferenceService.getMultiple(MEMORY_PREFERENCE_KEYS)
}

export function resolveMemoryConfig(values: MemoryPreferenceValues): MemoryConfig {
  const providers = getStoreProviders()
  const allModels = providers.flatMap((provider) => provider.models)
  const findModel = (id: string | null, provider: string | null) =>
    id && provider ? allModels.find((model) => model.id === id && model.provider === provider) : undefined

  const llmModel = findModel(values.llmModelId, values.llmModelProvider)
  const embeddingModel = findModel(values.embeddingModelId, values.embeddingModelProvider)

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
  const modelUpdates = {
    'feature.memory.llm_model_id': memoryConfig.llmModel?.id ?? null,
    'feature.memory.llm_model_provider': memoryConfig.llmModel?.provider ?? null,
    'feature.memory.embedding_model_id': memoryConfig.embeddingModel?.id ?? null,
    'feature.memory.embedding_model_provider': memoryConfig.embeddingModel?.provider ?? null
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
