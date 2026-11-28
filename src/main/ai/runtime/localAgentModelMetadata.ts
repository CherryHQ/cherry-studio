import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import type { LocalAgentModelCatalog } from '@shared/ai/localAgent'

const logger = loggerService.withContext('localAgentModelMetadata')

type CatalogModel = LocalAgentModelCatalog['models'][number]

function registryModelId(model: CatalogModel, presetId?: string): string {
  if (presetId === 'antigravity-acp' && model.id === 'gpt-oss-120b-medium') return 'gpt-oss-120b'
  if (presetId !== 'kimi' || !model.id.startsWith('kimi-code/')) return model.id
  const name = model.name.toLowerCase().trim()
  switch (model.id) {
    case 'kimi-code/kimi-for-coding':
      return name === 'k2.8 preview' ? 'kimi-k2-8-preview' : model.id
    case 'kimi-code/kimi-for-coding-highspeed':
      return name === 'k2.7 code highspeed' ? 'kimi-k2-7-code-highspeed' : model.id
    case 'kimi-code/k3-256k':
      return 'kimi-k3'
    default:
      return model.id.replace(/^kimi-code\//, 'kimi-')
  }
}

export function enrichLocalAgentModels(models: CatalogModel[], presetId?: string): CatalogModel[] {
  try {
    return models.map((model) => {
      const preset =
        providerRegistryService.findPresetModel(registryModelId(model, presetId)) ??
        (presetId === 'cursor' ? providerRegistryService.findPresetModel(model.name.trim().replace(/\s+/g, '-')) : null)
      if (!preset) return model
      const { id, capabilities, inputModalities, description } = preset
      return {
        ...model,
        ...(!model.description && description && { description }),
        registryModel: { id, capabilities: capabilities ?? [], inputModalities }
      }
    })
  } catch (error) {
    logger.warn('Failed to resolve local agent model display metadata', error as Error, { presetId })
    return models
  }
}
